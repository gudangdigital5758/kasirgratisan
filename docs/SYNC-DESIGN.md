# Profitku — Desain Sinkronisasi Lintas Perangkat (Phase A)

> **Status: IMPLEMENTED (M0–M4 selesai & ter-deploy).** Phase A membuka
> `has_sync` (langganan **Rp 25.000/bulan per TOKO**) menjadi sinkronisasi data
> nyata antar-perangkat: push/pull LWW + tombstone (Worker `/api/sync/*`),
> pipeline client (`src/lib/sync.ts`), gate `SYNC_ENABLED`, observability
> `platform_events`, dan first-sync otomatis di wizard toko online. Dokumen ini
> tetap menjadi referensi keputusan arsitektur.

## 1. Tujuan & lingkup

- **Tujuan:** Data kasir (produk, transaksi, stok, dll.) tersinkron antar-perangkat
  milik satu user/store: mis. HP kasir + tablet owner, atau HP lama → HP baru.
- **Model lisensi: Rp 25.000/bulan per TOKO** (`cloud_monthly`) — **bukan per
  device**. Pemilik bebas menggunakan perangkat sebanyak apa pun untuk satu toko
  yang sama (device hanyalah *client* dari store yang sama).
- **Kuota storage cloud: 1024 MB** (`BRAND.cloudStorageMb` = 1024).
- **Bukan tujuan v1:** realtime collaborative editing, konflik per-field yang rumit,
  multi-tenant marketplace.
- **Prinsip:** POS tetap berjalan **offline dulu**. Sync hanya berjalan saat online;
  kegagalan sync **tidak boleh** menandai data lokal sebagai tersinkron (fail-closed).

## 1b. Visi cloud (roadmap fitur)

Fitur cloud bertahap — **sync adalah fondasi** untuk semuanya:

| Tahap | Fitur | Ketergantungan |
|---|---|---|
| Sudah | Backup + auto-backup cloud (1024 MB, retensi 30 hari) | — |
| **Phase A (ini)** | **Sinkronisasi lintas perangkat (LWW v1)** | `syncId`, push/pull |
| Fase berikutnya | **Toko Online** (catalog publik, pesanan dari pelanggan) | sync + `stores` |
| Fase berikutnya | **Affiliate** (bagi hasil, link/QR affiliate, komisi) | toko online |
| Fase berikutnya | **Search optimasi: SEO & AI SEO** (judul/deskripsi otomatis, meta, sitemap) | toko online |
| Fase berikutnya | **Multi-store (offline & online)** — `docs/MULTI-STORE.md` | backup + sync stabil |
| Fase berikutnya | Integrasi payment lebih dalam | toko online |

> Catatan: `marketOrigin` (market.profitku.my.id) & `CloudOnlineStoreSettings` sudah
> ada sebagai awal toko online; affiliate + SEO/AI SEO dirancang di atasnya.

## 2. Kondisi eksisting (fondasi sudah ada)

| Aset | Status |
|---|---|
| `syncedAt` / `updatedAt` di semua tabel inti | ✅ Ada |
| Tabel tombstone `deletedRecords` + hook hard-delete | ✅ Ada |
| `setupSyncHooks` (updatedAt, reset syncedAt, tombstone) | ✅ Ada |
| Worker `stores` (per user) + `user_entitlements.has_sync` | ✅ Ada |
| `sync.ts` guard no-op + endpoint `/api/stores/:id/sync` (501) | ✅ Fail-closed |
| Backup cloud (R2 + 30 hari retention) | ✅ Sudah jalan |

→ Tinggal "menyalakan" dengan protokol push/pull + strategi ID.

## 3. Keputusan kritis #1 — Identitas record (ID)

Masalah: tabel lokal memakai auto-increment numerik (`++id`). ID ini bisa bentrok
antar-perangkat (dua device membuat produk id=1 berbeda). Relasi (mis.
`transactionItems.transactionId`, `stockOpnameItems.opnameId`) harus konsisten.

**Keputusan yang direkomendasikan (v1):** kolom `syncId` UUID per record.

- Tambah kolom `syncId: string` (UUID v4) di semua tabel yang di-sync.
- `syncId` dibuat saat record pertama kali dibuat di perangkat mana pun.
- Relasi disimpan **dua-duanya**: `transactionId` (numerik lokal, untuk query cepat)
  **dan** `transactionSyncId` (UUID, untuk resolusi lintas perangkat).
- Server menyimpan record dengan `syncId` sebagai kunci stabilitas; `id` numerik
  lokal tidak pernah dikirim antar-device (kecuali sebagai kunci sementara saat push
  batch yang belum punya syncId — ditangani via `syncState`).

**Alternatif yang ditolak v1:** migrasi ke UUID PK penuh (breaking total, risiko data
hilang), atau sinkronisasi hanya satu arah (backup-restore).

## 4. Keputusan kritis #2 — Strategi conflict

**v1: Last-Write-Wins (LWW) per record, berbasis `updatedAt` (server time).**

- Saat push, client mengirim `updatedAt` lokal. Server membandingkan dengan record
  server; yang lebih baru menang (baik push dari client, atau nilai server).
- Pull mengirim snapshot record yang server-nya lebih baru dari `syncedAt` client.
- Trade-off didokumentasikan: edit simultan di dua device → satu menang, tidak ada
  penggabungan per-field. Cukup untuk UMKM (satu kasir aktif per waktu).
- **Tidak** dilakukan v1: per-field merge, CRDT, op-log. Dicatat sebagai fase lanjutan.

## 5. Protokol push/pull

### Push — `POST /api/sync/push` (auth, butuh langganan aktif)
Body (per storeId):
```jsonc
{
  "storeId": "uuid",
  "records": {
    "products":  [ { "syncId": "...", "data": { ...kolom tanpa syncId... }, "updatedAt": "iso" }, ... ],
    "transactions": [ ... ],
    "...": []
  },
  "tombstones": [ { "table": "products", "syncId": "...", "deletedAt": "iso" } ]
}
```
Aturan:
- Batas ukuran (mis. 512 KB / batch) + rate limit (sudah ada).
- Server validasi per tabel dengan whitelist kolom; tolak field asing.
- Harga/nominal transaksi TIDAK ditulis ulang dari client untuk laporan (sudah
  snapshot saat checkout) — server hanya meneruskan.
- Response: daftar `syncId` yang diterima + `serverTime` (untuk sinkronisasi jam).

### Pull — `GET /api/sync/pull?storeId=...&since=<serverTime>`
- Server mengembalikan record dengan `server_updated_at > since` per tabel,
  termasuk tombstone (`deletedRecords`).
- Client menerapkan: insert/update LWW, dan hapus record yang tombstone-nya menang.

### Tombstone
- Hard delete di client sudah dicatat di `deletedRecords` (hook). Push mengirimnya;
  pull menerimanya. Record yang dihapus tidak boleh "hidup lagi" dari device lain
  kecuali LWW memutuskan (tombstone ikut `deletedAt`/`updatedAt`).

## 6. Model data tambahan (Supabase migrations baru)

```sql
-- migrasi: sync_meta (per user+store) & kolom syncId di tabel cloud
create table if not exists public.sync_meta (
  store_id uuid primary key references public.stores(id) on delete cascade,
  last_push_at timestamptz,
  last_pull_cursor timestamptz,
  device_count integer not null default 0,
  updated_at timestamptz not null default now()
);
```
- Tabel cloud untuk record sync memakai `syncId` unik; `stores` tetap pemilik data.
- `transactions`/`transactionItems` cloud menyimpan `store_id` (multi-store siap).

## 7. Perangkat & link store

- Endpoint `POST /api/stores/:id/register-device` — client mengirim `deviceId`
  (sudah ada di storeSettings) + nama device; server catat di `sync_meta.device_count`
  + tabel `devices` (uuid, store_id, name, last_seen_at).
- UI: halaman "Perangkat tersinkron" di CloudHub (list device, **unlok device** untuk
  kendali akses).
- **TIDAK ada batas jumlah device** — langganan per toko (`cloudMaxStores` = 1),
  berapapun device boleh terhubung ke toko yang sama. `device_count` hanya info/opsional.
- Guard tetap server-side: `has_sync` + `cloudMaxStores` dari entitlements.

## 8. Antrian offline & fail-closed

- Client menyimpan batch push di IndexedDB (`syncQueue` tabel baru) saat offline.
- `triggerBackgroundSync()` (sekarang no-op) menjadi nyata: antrian dikirim saat
  online, lalu `syncedAt` di-set **hanya setelah ack server**.
- Jika ack gagal → retry backoff; jangan pernah set `syncedAt` tanpa ack.

## 9. Entitlement & monetisasi

- `has_sync` di `user_entitlements` sudah ada; tetap **satu paket Rp 25.000/bulan
  per toko** dengan kuota **1024 MB** (`storage_limit_mb` = 1024 di plan & seed).
- Sync hanya untuk langganan aktif (server-side check di push/pull).
- **Urutan release:** backup (sudah) → sync v1 (LWW) → toko online → affiliate → SEO.

## 10. Rencana implementasi (urutan)

1. **M0 — Migrasi DB:** kolom `syncId` + `sync_meta` + `devices`; backfill syncId utk
   data existing; `setupSyncHooks` menghasilkan syncId saat create. **✅ Selesai (2026-08-05).**
2. **M1 — Server:** endpoint push/pull + validasi + LWW + tombstone; guard
   `has_sync`; ubah `501` sync jadi nyata. **✅ Selesai (2026-08-05)** — `POST /api/sync/push`,
   `GET /api/sync/pull`, migrasi `20260805120000_sync.sql` (sync_records + RPC LWW batch).
3. **M2 — Client:** `syncQueue`, push/pull pipeline, penerapan LWW, tombstones,
   `triggerBackgroundSync` nyata; UI link device di CloudHub. **✅ Selesai (2026-08-05)**
   — `src/lib/sync.ts` (collect→push→ack→pull→apply, fail-closed), `syncMeta` tabel,
   tombol "Sync Sekarang" di CloudHub + auto-sync saat app dibuka.
4. **M3 — Pengujian:** unit test push/pull/LWW; simulasi dua device (fake-indexeddb
   + dua profile); smoke manual; update docs. **✅ Selesai (2026-08-05)** — tambahan
   test simulasi dua device (`sync-two-device.test.ts`: konvergensi, edit lintas
   device, konflik LWW, tombstone); observability `platform_events` di push/pull.
5. **M4 — Release bertahap:** flag env, observability via `platform_events`.
   **✅ Selesai (2026-08-05)** — flag `SYNC_ENABLED` (Worker var, default `true`;
   `"false"` menonaktifkan push/pull sementara) + `writeEvent` (sync_push/sync_pull)
   + sync pertama otomatis saat wizard toko online membuat store cloud.
6. **Stabilisasi (2026-08-06):** status sync UX di CloudHub (dirty/konflik/error),
   retry otomatis saat online/foreground (`initSyncListeners`), doc status.
   **Uji perangkat nyata:** ikuti `docs/SYNC-QA.md` (7 skenario).

## 11. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Bentrok ID lintas device | `syncId` UUID + relasi dual (numerik & syncId) |
| Konflik edit simultan | LWW v1 didokumentasikan; uji dua device |
| Data lokal salah ditandai tersinkron | `syncedAt` hanya setelah ack server (fail-closed) |
| Payload besar / abuse | Batas ukuran + rate limit (sudah ada) |
| Migrasi data existing (tanpa syncId) | Backfill satu kali saat upgrade versi Dexie |

## 12. Keputusan v1 (default — bisa direvisi saat review)

| # | Keputusan | Catatan |
|---|---|---|
| 1 | **Conflict: Last-Write-Wins per record** berbasis `updatedAt` (server time) | Per-field merge/CRDT = fase lanjutan |
| 2 | **Identitas: `syncId` UUID** + relasi ganda (`transactionId` + `transactionSyncId`) | Paling praktis untuk offline-first |
| 3 | **Perangkat: TANPA batas** — langganan per toko (Rp 25rb/1 toko), berapapun device | Sesuai keputusan produk |
| 4 | **Tombstone: diperluas ke semua tabel sync** (bukan hanya 5 tabel) | Agar hapus/soft-delete konsisten lintas device |
| 5 | **Storage: 1024 MB** per langganan | `BRAND.cloudStorageMb` & seed plan = 1024 |
| 6 | **`deletedRecords` tetap lokal** (tidak dikirim ke server sebagai data user) | Tombstone dikirim sebagai metadata, bukan tabel cloud |

Jika ada yang ingin diubah, coret/revisi di tabel ini sebelum implementasi dimulai.
