# Profitku — QA Sinkronisasi Antar-Perangkat (perangkat nyata)

> Panduan pengujian manual **Phase A sync (M0–M4)** di perangkat nyata.
> Butuh **2 perangkat** (HP/tablet/browser) + langganan cloud aktif.
> Tujuan: memvalidasi konvergensi LWW, tombstone, dan UX sebelum rilis luas.

## Prasyarat

- [ ] 2 perangkat (mis. HP Android + browser PC, atau 2 HP).
- [ ] Keduanya login **akun Google yang sama** (Supabase session).
- [ ] Langganan `cloud_monthly` aktif (Rp 25.000) — cek Settings → Profitku Cloud.
- [ ] Worker production sehat: `https://api.profitku.my.id/health` → `ok:true`.
- [ ] Migrasi sync sudah applied: `supabase_migrations` berisi `20260805120000`.

---

## Skenario 1 — First-sync via wizard toko online (A → B)

1. **Device A:** Settings → Toko → Tambah toko → pilih **Toko Online**.
   - Harapan: setelah bind cloud, otomatis `syncNow()` jalan (first-sync) —
     cek log `[stores] sync awal` / `platform_events` type `sync_push` + `sync_pull`.
2. **Device A:** buat 1 produk baru (mis. "Produk QA-1", SKU `QA1`).
3. **Device A:** Settings → Profitku Cloud → "Sinkronisasi Antar-Perangkat" → **Sync Sekarang**.
   - Harapan: toast sukses, `platform_events.sync_push` bertambah.
4. **Device B:** buka app, Settings → Profitku Cloud → pilih toko yang sama → **Sync Sekarang**.
   - Harapan: `Produk QA-1` muncul di daftar produk B.

## Skenario 2 — Edit menyebar (konvergensi LWW)

1. Di **A**, edit nama `Produk QA-1` → "Produk QA-1 v2". Sync di A.
2. Di **B**, Sync. Harapan: nama jadi v2 (server lebih baru menang).
3. Di **B**, edit harga → sync di B → sync di A. Harapan: harga baru muncul di A.

## Skenario 3 — Konflik LWW (edit hampir bersamaan)

1. Di **A** dan **B** hampir bersamaan edit produk yang sama (B menulis lebih lambat).
2. Sync di A lalu B (urutan mana pun).
3. Harapan: **versi dengan `updatedAt` terbaru menang** di kedua perangkat.
   Kartu sync di CloudHub menampilkan "N konflik diselesaikan (versi terbaru menang)".

## Skenario 4 — Hapus (tombstone) menyebar

1. Di **A**, hapus `Produk QA-1` (soft-delete) → Sync di A.
2. Di **B**, Sync. Harapan: produk **ikut terhapus** (hilang dari daftar) di B.

## Skenario 5 — Offline tidak merusak data

1. Matikan internet (airplane mode) di **A**.
2. Di A: buat transaksi kasir normal (harus tetap jalan — offline-first).
3. Nyalakan internet → app kembali ke foreground (atau tekan Sync).
   Harapan: data transaksi tersinkron setelah online (retry otomatis via `initSyncListeners`).

## Skenario 6 — Backup lokal otomatis (offline, Android)

1. Di Android: Settings → Backup & Restore.
   - Harapan: kartu "Auto Backup (Lokal)" default "Setiap 1 jam"; setelah dibuka,
     otomatis ada snapshot (terakhir = sekarang).
2. Cek folder `Documents/Profitku-backups` (file manager): file JSON fisik ada.
3. Uji restore: buat perubahan merusak (mis. import file salah) → Restore dari snapshot.

## Skenario 7 — Gagal sync terlihat jelas

1. Nonaktifkan sementara di Worker (`SYNC_ENABLED = "false"`) ATAU matikan internet saat Sync.
2. Harapan: CloudHub menampilkan **error terakhir** (teks merah) tanpa crash.

---

## Cek observability (dashboard/admin)

```sql
-- Sudah ada event sync?
select type, message, created_at
from platform_events
where type in ('sync_push','sync_pull')
order by created_at desc
limit 20;
```

Harapan: baris muncul tiap push/pull berhasil.

## Selesai / rollback

- [ ] Semua skenario lulus → sync siap rilis luas.
- [ ] Ada kegagalan → catat skenario, cek log Worker (`wrangler tail`) + `platform_events`.
- [ ] Membersihkan data uji: hapus produk QA di kedua device (tombstone akan menyebar).
