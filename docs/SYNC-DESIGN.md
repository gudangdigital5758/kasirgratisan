# Profitku — Desain Sinkronisasi Lintas Perangkat (Phase A)

> Draf teknis untuk review. **Belum diimplementasikan.** Tujuan: membuka
> `has_sync` (langganan Rp 25rb) menjadi sinkronisasi data nyata antar-perangkat,
> bukan hanya backup. Dokumen ini menentukan keputusan arsitektur sebelum kode.

## 1. Tujuan & lingkup

- **Tujuan:** Data kasir (produk, transaksi, stok, dll.) tersinkron antar-perangkat
  milik satu user/store: mis. HP kasir + tablet owner, atau HP lama → HP baru.
- **Bukan tujuan v1:** realtime collaborative editing, konflik per-field yang rumit,
  multi-tenant marketplace.
- **Prinsip:** POS tetap berjalan **offline dulu**. Sync hanya berjalan saat online;
  kegagalan sync **tidak boleh** menandai data lokal sebagai tersinkron (fail-closed).

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
- UI: halaman "Perangkat tersinkron" di CloudHub (list device, unlok device).
- Guard: `cloudMaxStores` (1) & `has_sync` tetap dari entitlements server.

## 8. Antrian offline & fail-closed

- Client menyimpan batch push di IndexedDB (`syncQueue` tabel baru) saat offline.
- `triggerBackgroundSync()` (sekarang no-op) menjadi nyata: antrian dikirim saat
  online, lalu `syncedAt` di-set **hanya setelah ack server**.
- Jika ack gagal → retry backoff; jangan pernah set `syncedAt` tanpa ack.

## 9. Entitlement & monetisasi

- `has_sync` di `user_entitlements` sudah ada; tetap satu paket 25rb.
- Sync hanya untuk langganan aktif (server-side check di push/pull).
- **Urutan release:** backup dulu (sudah), lalu sync v1 (LWW), lalu multi-store.

## 10. Rencana implementasi (urutan)

1. **M0 — Migrasi DB:** kolom `syncId` + `sync_meta` + `devices`; backfill syncId utk
   data existing; `setupSyncHooks` menghasilkan syncId saat create.
2. **M1 — Server:** endpoint push/pull + validasi + LWW + tombstone; guard
   `has_sync`; ubah `501` sync jadi nyata.
3. **M2 — Client:** `syncQueue`, push/pull pipeline, penerapan LWW, tombstones,
   `triggerBackgroundSync` nyata; UI link device di CloudHub.
4. **M3 — Pengujian:** unit test push/pull/LWW; simulasi dua device (fake-indexeddb
   + dua profile); smoke manual; update docs.
5. **M4 — Release bertahap:** flag env, observability via `platform_events`.

## 11. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Bentrok ID lintas device | `syncId` UUID + relasi dual (numerik & syncId) |
| Konflik edit simultan | LWW v1 didokumentasikan; uji dua device |
| Data lokal salah ditandai tersinkron | `syncedAt` hanya setelah ack server (fail-closed) |
| Payload besar / abuse | Batas ukuran + rate limit (sudah ada) |
| Migrasi data existing (tanpa syncId) | Backfill satu kali saat upgrade versi Dexie |

## 12. Pertanyaan terbuka untuk review

1. Apakah LWW per-record (bukan per-field) dapat diterima untuk v1?
2. Kolom relasi ganda (`transactionSyncId`) — setuju, atau mau pendekatan lain?
3. Perangkat maksimum per store (mis. 3) perlu dibatasi di v1?
4. `deletedRecords` saat ini hanya utk 5 tabel — perlu diperluas ke semua tabel sync?
