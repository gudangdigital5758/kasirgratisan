# Profitku Cloud - Rencana Implementasi Per Toko

**Status:** In progress
**Target:** backup online per toko, sinkronisasi otomatis multi-device per toko,
dan langganan Rp 25.000/bulan per toko dengan detail masa aktif serta sisa quota.

## 1. Keputusan Produk

- POS, stok, laporan, dan multi-user lokal tetap berjalan tanpa cloud.
- Unit lisensi adalah toko, bukan akun atau device.
- Harga utama `cloud_monthly` adalah Rp 25.000 per bulan per toko.
- User boleh memiliki banyak toko cloud; setiap toko membutuhkan subscription aktif
  sendiri.
- Quota default adalah 1024 MB per toko dan dihitung dari `backups.store_id`.
- Device tidak dibatasi jumlahnya untuk satu toko aktif.
- Toko tanpa subscription aktif tetap dapat dipakai sebagai toko lokal/offline.
- Sync memakai Last-Write-Wins per record pada fase awal.
- Backup cloud dan sync adalah dua fungsi berbeda: backup untuk recovery, sync untuk
  konvergensi data antar-device.
- Retention backup cloud tetap 30 hari sampai ada keputusan produk baru.

## 2. Arsitektur Target

```text
PWA / Android device
  - IndexedDB toko aktif sebagai local source of truth
  - Supabase Auth access token
  - auto-sync queue + auto-backup scheduler
           |
           | HTTPS Bearer + storeId
           v
Cloudflare Worker
  - auth validation
  - ownership dan entitlement per toko
  - checkout dan webhook payment
  - backup quota + R2 metadata
  - sync push/pull + cursor
           |
           +--> Supabase Auth + Postgres
           |      profiles, stores, subscriptions, payments,
           |      backups, sync_records, entitlements
           |
           +--> Cloudflare R2
                  backup JSON object per user/store
```

Boundary yang wajib dipertahankan:

- Client tidak boleh menerima atau memuat service role key.
- Worker adalah boundary resmi untuk billing, quota, R2, dan sync.
- Supabase RLS tetap aktif; RPC `SECURITY DEFINER` hanya boleh dipanggil Worker.
- `storeId` wajib divalidasi terhadap `user_id` pada setiap endpoint per toko.
- IndexedDB tetap menjadi sumber data POS; cloud down tidak boleh memblokir kasir.

## 3. Kondisi Saat Ini

### Sudah tersedia

- Supabase Auth dengan access/refresh session.
- Registry multi-store lokal dan DB Dexie terpisah per toko.
- R2 backup upload, download, list, delete, dan metadata Supabase.
- `store_entitlements` dengan status sync, expiry, limit, dan ukuran backup.
- Worker sync push/pull dan client pipeline `src/lib/sync.ts`.
- Auto-sync saat app focus, online, dan interval berkala.
- UI Cloud Store Settings dengan status subscription dan quota per toko.

### Refactor baseline yang dilakukan bersama dokumen ini

- Cloud store dapat dibuat setelah login tanpa harus memiliki subscription global.
- Checkout dari CloudHub mengirim `storeId` toko aktif.
- Cloud Store Settings memuat toko walaupun belum ada subscription aktif.
- Auto-backup dan auto-sync memakai entitlement toko aktif, bukan hanya entitlement
  agregat akun.
- Query list backup memakai satu `URLSearchParams`, termasuk `storeId`, `page`, dan
  `limit`.
- API profile dan stores menyajikan `usedMb` serta `remainingMb` per toko.
- Fallback plan diselaraskan menjadi unlimited toko dengan subscription per toko.
- Endpoint Google Play yang belum memverifikasi pembelian dinonaktifkan dengan 410.
- Migration hardening membatasi RPC sync dan view entitlement ke service role.
- Checkout baru mewajibkan `cloud_monthly` aktif dan `storeId` UUID milik user.
- Payment disimpan sebelum gateway dan fulfillment subscription memakai RPC atomik
  dengan payment lock serta unique active subscription per toko.
- Webhook Midtrans/SumoPod memeriksa provider dan nominal sebelum fulfillment.

### Gap yang masih harus diselesaikan

- Payment fulfillment atomik sudah tersedia; refund/chargeback reconciliation dan
  integration test provider masih harus diselesaikan.
- Quota masih dihitung melalui scan metadata dengan batas record, belum memakai ledger
  atau lock per toko.
- Sync payload, cursor, timestamp, dan client acknowledgement masih perlu hardening.
- Beberapa tabel sync belum memiliki hook, timestamp, atau relasi lintas-device lengkap.
- Endpoint detail online store belum tersedia di Worker.
- Belum ada integration test Worker + Supabase + R2.

## 4. Kontrak Data Per Toko

### `stores`

- `stores.id` menjadi root scope cloud.
- `stores.user_id` wajib sama dengan pemilik token.
- `stores` boleh ada tanpa subscription untuk mendukung pembuatan toko offline/cloud
  sebelum checkout.

### `subscriptions`

- Subscription baru wajib memiliki `user_id`, `store_id`, `plan_id`, status, period
  start/end, provider, dan provider reference.
- `store_id = NULL` hanya boleh untuk data legacy yang sudah ada sebelum model per toko.
- Akses aktif: `status in ('active', 'trialing')` dan `current_period_end > now()`;
  pengecualian lifetime harus eksplisit.
- Perpanjangan memakai `max(now(), current_period_end)`.

### `payments`

- Payment baru wajib menyimpan `store_id` dan nominal hasil kalkulasi server.
- `provider_ref` harus unik dalam kombinasi provider.
- Fulfillment harus idempotent berdasarkan payment UUID dan provider reference.
- Payment completed tanpa subscription harus masuk monitoring/reconciliation queue.

### `backups`

- Setiap row wajib mempunyai `user_id`, `store_id`, `file_key`, `file_size`, dan
  timestamp.
- R2 key menggunakan format `backups/{userId}/{storeId}/{uuid}-{safeFileName}`.
- Download, delete, dan restore hanya boleh untuk backup milik user dan store target.
- API response wajib menyertakan `storeId`, nama toko, ukuran file, tanggal dibuat,
  dan status retention bila dibutuhkan UI.

### `sync_records`

- Unique key: `(store_id, table_name, sync_id)`.
- Record disimpan sebagai data tervalidasi per tabel, bukan JSON arbitrary tanpa batas.
- Tombstone harus mempunyai timestamp dan retention policy.
- Pull menggunakan cursor stabil, bukan `now()` sebagai cursor implisit.

## 5. Kontrak Endpoint Target

| Endpoint | Fungsi | Scope wajib |
|---|---|---|
| `GET /api/user/profile` | profile dan fallback account status | user |
| `GET /api/stores` | daftar toko + entitlement + quota | user |
| `POST /api/stores` | membuat toko cloud tanpa subscription | user |
| `POST /api/payments/checkout` | checkout per toko | `storeId` |
| `POST /webhook/payment` | fulfillment payment idempotent | payment |
| `GET /api/backups?storeId=...` | list backup | owner + store |
| `POST /api/backups` | upload backup | owner + active entitlement |
| `GET /api/backups/:id/download` | download backup | owner + metadata |
| `DELETE /api/backups/:id` | delete backup | owner + metadata |
| `POST /api/sync/push` | push dirty records/tombstones | owner + active entitlement |
| `GET /api/sync/pull` | pull perubahan dengan cursor | owner + active entitlement |

Aturan endpoint:

- Response authorization failure tidak boleh membocorkan apakah store milik user lain.
- `storeId`, backup ID, payment ID, dan sync ID harus divalidasi formatnya sebelum
  dipakai sebagai filter PostgREST.
- Endpoint baru tidak boleh mempercayai nominal, expiry, entitlement, atau quota dari
  client.

## 6. Fase Implementasi

### Fase 0 - Contract dan migration gate

Tujuan: memastikan seluruh layer memakai model subscription per toko yang sama.

- Terapkan `20260811100000_cloud_scope_hardening.sql` ke Supabase production.
- Verifikasi execute privilege RPC `sync_upsert_batch` dan `sync_register_device`.
- Selaraskan `seed.sql`, `seed-plans.ts`, `brand.ts`, dan UI agar unlimited toko.
- Tandai subscription `store_id IS NULL` sebagai legacy dan buat laporan migrasi.
- Tambahkan check migration version ke deployment checklist.
- Pastikan `PAYMENT_PROVIDER`, R2 binding, Supabase secrets, dan cron production
  terdokumentasi dalam satu sumber.

Acceptance criteria:

- Anonymous/authenticated tidak dapat memanggil RPC sync secara langsung.
- Seed menghasilkan `cloud_monthly` Rp 25.000, 1024 MB, dan `max_stores = NULL`.
- Worker dan frontend tidak lagi menganggap satu akun hanya boleh satu toko.

### Fase 1 - Entitlement dan subscription per toko

Tujuan: satu sumber kebenaran untuk status, masa aktif, dan quota tiap toko.

- Wajibkan `storeId` pada checkout baru.
- Validasi plan aktif dan kategori `SYNC` di Worker.
- Buat RPC fulfillment atomik dengan payment lock.
- Tambahkan unique partial index untuk subscription aktif per user/store setelah data
  duplicate dibersihkan.
- Simpan `payments.subscription_id` setelah subscription berhasil dibuat.
- Cocokkan amount, currency, provider, provider reference, dan status webhook.
- Tangani refund, chargeback, expired, dan webhook replay.
- Ubah dunning agar mengambil `store_id`, nama toko, expiry, dan dedupe per subscription.

Acceptance criteria:

- Subscription A tidak pernah mengaktifkan toko B.
- Renewal memperpanjang toko yang dipilih, bukan akun secara global.
- Dua webhook identik hanya menghasilkan satu subscription extension.
- UI menampilkan plan, status, tanggal mulai, tanggal berakhir, dan lifetime bila berlaku.

### Fase 2 - Backup online per toko

Tujuan: recovery data aman dan quota terisolasi per toko.

- Jadikan `storeId` wajib pada upload baru.
- Validasi ownership dan `store_entitlements.has_sync` sebelum upload.
- Ganti quota scan terbatas dengan RPC/ledger quota atomik per store.
- Tambahkan idempotency key untuk retry upload.
- Gunakan R2 key yang menyertakan `storeId`.
- Implementasikan pagination server dan client yang sebenarnya.
- Kembalikan `remainingMb` dari Worker sebagai angka yang konsisten.
- List backup harus selalu difilter berdasarkan toko aktif.
- Restore harus memeriksa bahwa backup dan database lokal adalah toko yang sama;
  restore toko lain memerlukan konfirmasi eksplisit atau diblokir.
- Cleanup retention harus memproses semua halaman dan mencatat orphan R2.
- Evaluasi menghapus `users.pinHash`, `deviceId`, dan credential lokal dari backup cloud.

Acceptance criteria:

- Upload toko A tidak mengubah quota toko B.
- Dua upload bersamaan tidak dapat melewati quota.
- User dapat melihat `used / limit / remaining` per toko.
- Restore backup toko A tidak dapat menimpa toko B tanpa konfirmasi khusus.
- Backup berumur lebih dari 30 hari dihapus dari R2 dan metadata.

### Fase 3 - Sync otomatis multi-device per toko

Tujuan: semua device toko yang sama mencapai state yang sama tanpa tombol manual.

- Tetapkan allowlist tabel sync dan field yang boleh dipersist server.
- Tambahkan batas payload bytes, record count, field length, dan ukuran foto.
- Gunakan server receive time dengan batas clock skew client.
- Implementasikan cursor keyset dengan `nextCursor` dan pagination.
- Pastikan tombstone ikut cursor dan mempunyai retention yang aman.
- Tambahkan queue lokal per toko, backoff, retry, dan status pending.
- Tambahkan mutex agar push/pull tidak overlap.
- Ack harus menyertakan revision atau hash yang dikumpulkan; edit baru tidak boleh
  ikut ditandai synced.
- Lengkapi hook `syncId`, `updatedAt`, dan `syncedAt` untuk roles, transactionItems,
  stockOpnameItems, stockLots, dan stockLotAllocations.
- Lengkapi dual-FK untuk transaction item, stock lot, stock-in, dan stock-out.
- Jangan sync credential PIN lokal tanpa desain auth per toko yang baru.
- Terapkan pull dalam transaksi Dexie dan normalisasi Date sebelum data dipakai UI.
- Auto-sync dijalankan saat app start, focus, online, perubahan dengan debounce, dan
  interval berkala.

Acceptance criteria:

- Device A membuat produk, device B menerima produk tanpa tombol manual.
- Edit di dua device mengikuti aturan LWW yang terdokumentasi.
- Delete/tombstone tidak menghidupkan kembali record lama.
- Offline transaction tetap berjalan dan masuk queue setelah online.
- Sync gagal tidak menandai data sebagai synced.
- Payload lebih besar dari batas ditolak tanpa mengubah state lokal.

### Fase 4 - Frontend Cloud Hub per toko

Tujuan: UI tidak lagi menampilkan status cloud agregat secara ambigu.

- Cloud Hub menampilkan kartu semua toko lokal/cloud.
- Setiap kartu menampilkan nama toko, mode, subscription status, plan, expiry,
  storage used, storage limit, dan storage remaining.
- Toko cloud dapat dibuat setelah login; subscription dibeli dari kartu toko tersebut.
- Toko offline tidak menampilkan quota cloud.
- Toko expired menampilkan CTA simpan backup terakhir ke device lalu turun offline.
- Auto-backup dan auto-sync hanya aktif untuk toko aktif yang entitlement-nya aktif.
- Tampilkan status `lastSyncAt`, pending changes, conflict count, dan error terakhir.
- Jangan menampilkan tombol sync yang pasti akan ditolak server.
- Semua string baru harus tersedia di locale `id`, `en`, dan `ms`.

Acceptance criteria:

- User dengan dua toko dapat membayar dan memperpanjang toko yang benar.
- Masa aktif dan sisa quota terlihat tanpa membuka halaman global lain.
- Mengganti toko mengganti database lokal dan scope API.
- Toko tanpa langganan tetap dapat digunakan offline.

### Fase 5 - Test, observability, dan rollout

- Tambahkan Worker unit test untuk authorization, plan, amount, quota, dan cursor.
- Tambahkan Supabase SQL test untuk RLS, view ACL, RPC grants, dan ownership.
- Tambahkan webhook replay/idempotency test untuk Midtrans/SumoPod.
- Tambahkan R2 integration test untuk orphan cleanup dan delete store.
- Tambahkan fake-indexeddb test untuk concurrent sync dan two-device convergence.
- Tambahkan test restore lintas toko dan credential exclusion.
- Tambahkan CI: app typecheck, lint, test, build, Worker typecheck, migration check.
- Deploy dengan `SYNC_ENABLED=false` terlebih dahulu.
- Aktifkan sync untuk internal tester, lalu rollout bertahap berdasarkan
  `platform_events` dan error rate.
- Monitor payment completed tanpa subscription, quota rejection, sync failure,
  conflict count, dan R2 cleanup error.

## 7. Urutan Deploy

1. Backup database dan metadata R2 sebelum migration.
2. Terapkan migration Supabase dan verifikasi grants/RLS.
3. Deploy Worker yang kompatibel dengan schema lama dan baru.
4. Deploy frontend setelah Worker health check lulus.
5. Jalankan smoke test satu toko dan dua device.
6. Aktifkan `SYNC_ENABLED=true` setelah test convergence lulus.
7. Monitor minimal 24 jam sebelum membuka rollout lebih luas.

## 8. Smoke Test Minimum

- Login Google pada dua device dengan akun yang sama.
- Buat toko cloud tanpa subscription.
- Beli subscription untuk toko tersebut dan cek expiry.
- Cek quota awal dan sisa quota.
- Upload backup dari device A.
- List dan download backup pada device B.
- Buat produk di device A dan tunggu auto-sync ke device B.
- Matikan internet, buat transaksi, nyalakan internet, dan cek retry.
- Hapus record di device A dan cek tombstone di device B.
- Pastikan toko kedua tidak melihat backup, quota, atau data toko pertama.
- Biarkan subscription expired dan verifikasi toko tetap bisa digunakan offline.

## 9. Risiko yang Diterima di V1

- Konflik simultan memakai LWW per record, bukan merge per field.
- Realtime collaborative editing belum menjadi target.
- Device tidak dibatasi, sehingga abuse control harus memakai rate limit dan anomaly
  monitoring, bukan limit jumlah device.
- Backup retention hanya 30 hari; user harus diberi warning yang jelas.
- Cloud restore tetap operasi destructive dan harus meminta konfirmasi.

## 10. Gate Rilis

Fitur tidak boleh dinyatakan production-ready jika salah satu kondisi berikut benar:

- RPC sync masih dapat dipanggil anon/authenticated.
- Endpoint payment dapat membuat subscription tanpa verifikasi provider.
- Checkout tidak memiliki `storeId`.
- Sync pull belum memiliki pagination/cursor aman.
- Backup quota masih memakai perhitungan terbatas/racy.
- Restore dapat mencampur dua toko tanpa validasi.
- Tidak ada test dua device dan webhook idempotency.
