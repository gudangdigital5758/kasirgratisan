# Profitku Cloud - Rencana Perbaikan Linking Toko Lokal ke Cloud

**Status:** Proposed
**Prioritas:** High
**Tujuan:** menyamakan alur UX dan data dengan konsep satu akun Google yang memiliki
banyak toko lokal, lalu mendaftarkan sebagian toko tersebut ke cloud secara
individual.

## 1. Masalah Yang Terlihat

Pada kondisi saat ini user dapat melihat status akun Cloud aktif, tetapi toko lokal
seperti `GSM` tetap tampil sebagai offline dan Cloud Hub menampilkan:

```text
Belum ada toko di cloud
Buat Toko Sekarang
```

Masalahnya adalah istilah dan alurnya tidak sesuai kebutuhan:

- Toko lokal yang sudah ada belum mempunyai alur `Daftarkan ke Cloud`.
- Tombol `Buat Toko Sekarang` berpotensi membuat cloud store kosong baru, bukan
  mendaftarkan data toko lokal yang sedang dipakai.
- Status subscription di bagian atas masih mudah terbaca sebagai status global akun,
  padahal lisensi dan entitlement harus per toko.
- User belum mendapat satu tampilan yang jelas untuk membandingkan expiry dan quota
  semua toko.
- Subscription legacy dengan `store_id = NULL` belum memiliki alur binding eksplisit.

## 2. Target Produk

Satu akun Google dapat memiliki jumlah toko lokal dan cloud yang **tidak dibatasi**.
Lima toko di bawah hanya contoh skenario, bukan batas produk:

```text
Toko A  Cloud aktif
Toko B  Cloud aktif
Toko C  Cloud aktif
Toko D  Offline
Toko E  Offline
```

Aturan target:

- Tidak ada batas jumlah toko dalam satu akun Google OAuth.
- Setiap toko cloud tetap membutuhkan subscription sendiri.
- Satu toko cloud aktif membayar Rp 25.000 per bulan.
- Lima toko aktif cloud berjumlah Rp 125.000 per bulan.
- Tiga toko aktif cloud berjumlah Rp 75.000 per bulan.
- Toko offline tidak memakai quota dan tidak memerlukan subscription.
- Semua toko dapat diakses dalam satu sesi akun Google OAuth.
- Data lokal toko tidak boleh hilang ketika subscription berakhir.
- Reaktivasi memakai cloud store yang sama, bukan membuat cloud store baru.

## 3. Model Data Target

### Local store

`kasirgratisan-stores` tetap menjadi registry lokal:

- `storeKey`: identitas DB lokal pada device.
- `dbName`: database Dexie toko.
- `mode`: `local` atau `cloud`.
- `cloudStoreId`: nullable dan diisi setelah user mendaftarkan toko ke cloud.
- Nama, kategori, dan tipe toko tetap berasal dari data lokal.

`mode` hanya menunjukkan koneksi toko pada device. Status subscription tidak boleh
disimpan sebagai sumber kebenaran permanen di IndexedDB.

### Cloud store

Satu row `stores` mewakili satu toko cloud yang dimiliki user:

- `stores.id` menjadi `cloudStoreId`.
- `stores.user_id` wajib sama dengan user OAuth.
- Nama cloud mengikuti nama toko lokal saat registrasi awal.
- Perubahan nama setelah terhubung harus memiliki aturan sinkronisasi yang jelas.

### Subscription

Subscription baru wajib scoped ke:

```text
user_id + store_id + plan_id + period + provider
```

`store_id = NULL` hanya dipertahankan untuk data legacy dan harus dimigrasikan melalui
alur binding eksplisit.

### Entitlement

Setiap kartu toko mengambil data dari `store_entitlements`:

- `has_sync` atau status cloud aktif.
- `sync_expiry` atau tanggal berakhir.
- `storage_limit_mb`.
- `backup_bytes`.
- `used_mb`.
- `remaining_mb`.
- `is_lifetime` bila ada voucher lifetime.

Entitlement selalu diambil ulang dari Worker. Client tidak boleh menentukan sendiri
apakah subscription aktif.

## 4. State Toko Yang Harus Ditampilkan

| State | Arti | CTA utama |
|---|---|---|
| `offline` | Toko hanya lokal dan belum didaftarkan | `Daftarkan ke Cloud` |
| `cloud_unsubscribed` | Toko sudah punya cloud store tetapi belum berlangganan | `Langganan Rp25.000` |
| `cloud_active` | Subscription aktif | `Backup`, `Sync`, `Perpanjang` |
| `cloud_expiring` | Akan berakhir dalam batas warning | `Perpanjang` |
| `cloud_expired` | Subscription berakhir, data lokal tetap tersedia | `Simpan Backup`, `Aktifkan Lagi` |
| `cloud_restoring` | Backup terakhir sedang dipersiapkan | `Batalkan` atau tunggu |
| `cloud_error` | Status gagal dimuat | `Coba Lagi` |

Label `Offline - Aktif` tidak boleh dipakai untuk menyatakan subscription cloud.
Gunakan label terpisah seperti `Mode Offline` dan `Cloud Belum Terdaftar`.

## 5. Alur User Yang Baru

### A. Membuat banyak toko lokal

1. User membuat sejumlah toko sesuai kebutuhan melalui menu Toko.
2. User bebas memilih mode offline untuk semua toko.
3. Semua toko tampil di registry lokal dan dapat dibuka dalam satu akun Google.

### B. Mendaftarkan toko lokal ke cloud

1. User membuka Cloud Hub.
2. Cloud Hub menampilkan semua toko lokal, bukan hanya toko cloud.
3. Pada toko `GSM`, user melihat CTA `Daftarkan GSM ke Cloud`.
4. User mengonfirmasi nama dan data toko yang akan didaftarkan.
5. Worker membuat satu row cloud store atau mengembalikan row yang sama untuk retry
   idempotent.
6. Client menyimpan `cloudStoreId` pada entry lokal GSM.
7. Client mengirim backup awal toko GSM.
8. UI menawarkan pembelian subscription untuk GSM.

Registrasi toko cloud tidak boleh membuat database lokal baru atau menghapus data lokal.

### C. Membeli subscription per toko

1. User memilih kartu toko tertentu.
2. Worker menerima `storeId` dan memvalidasi ownership.
3. Worker menghitung harga dari plan server-side.
4. Payment row menyimpan `store_id` sejak awal.
5. Webhook memverifikasi provider, nominal, dan payment reference.
6. RPC fulfillment mengunci payment dan membuat/memperpanjang subscription toko.
7. UI refresh entitlement toko tersebut saja.

### D. Monitoring lima toko

Setiap kartu toko wajib menampilkan:

```text
Nama toko
Mode: Offline / Cloud
Status subscription
Berlaku s/d: tanggal
Penyimpanan: terpakai / limit MB
Sisa quota: MB
Backup terakhir
Sync terakhir
```

Tidak boleh memakai quota agregat akun sebagai nilai utama pada kartu toko.

### E. Hanya memperpanjang sebagian toko

1. User memilih sebagian kartu toko yang akan diperpanjang.
2. Checkout dibuat per toko atau satu checkout batch yang menghasilkan payment item
   terikat ke setiap `store_id`.
3. Total bulanan dihitung dari jumlah toko yang dipilih dikali Rp 25.000.
4. Toko lain tetap lokal dan tidak menerima backup/sync cloud baru.
5. Cloud store dan riwayat subscription toko yang tidak diperpanjang tetap disimpan.

V1 paling aman memakai checkout satu toko per transaksi. Checkout batch dapat menjadi
fase lanjutan setelah idempotency payment per toko stabil.

## 6. Perilaku Saat Subscription Berakhir

### Aturan utama

- Jangan menghapus cloud store saat subscription expired.
- Jangan menghapus database lokal.
- Hentikan upload backup dan sync cloud untuk toko tersebut.
- Toko tetap dapat digunakan penuh secara offline.
- Status kartu berubah menjadi `Cloud Expired` dan `Mode Offline`.
- Reaktivasi menggunakan `cloudStoreId` yang sama.

### Restore backup terakhir

Restore tidak boleh otomatis tanpa konfirmasi karena dapat menimpa transaksi lokal
yang lebih baru. Alur aman:

1. Saat online dan subscription akan/baru expired, cari backup terakhir toko.
2. Tawarkan `Simpan Backup Terakhir ke Perangkat`.
3. Buat snapshot lokal sebelum restore.
4. Download backup ke staging/temporary storage.
5. Tampilkan tanggal backup dan ukuran file.
6. Minta konfirmasi eksplisit.
7. Restore dengan mekanisme rollback.
8. Null-kan binding cloud hanya jika user memang memilih memutuskan koneksi.

Jika device sedang offline saat expiry, jangan memaksa restore. Tampilkan pending
warning saat device kembali online.

### Retention

Retention backup 30 hari harus dibedakan dari expiry subscription:

- Expired tidak langsung menghapus backup.
- Backup tetap read-only selama retention masih berlaku.
- Setelah 30 hari, backup boleh dihapus sesuai policy.
- UI harus memperlihatkan tanggal terakhir backup dan batas recovery bila diketahui.

## 7. Refactor Yang Diperlukan

### Frontend

- `src/pages/settings/CloudHub.tsx`
  - Ubah daftar menjadi daftar semua toko lokal.
  - Tampilkan state per toko.
  - Hilangkan CTA global yang tidak memiliki toko target.
- `src/pages/settings/CloudStoreSettings.tsx`
  - Tambahkan `Daftarkan ke Cloud` untuk entry lokal yang belum terhubung.
  - Tampilkan detail expiry dan quota per toko.
- `src/components/AddStoreWizard.tsx`
  - Bedakan `buat toko lokal`, `buat cloud store baru`, dan `daftarkan toko lokal`.
- `src/lib/store-registry.ts`
  - Sediakan helper linking/unlinking yang idempotent.
- `src/lib/cloud-api.ts`
  - Tambahkan API register/link store dan response state per toko.
- `src/hooks/use-cloud-auto-backup.ts`
  - Scheduler hanya aktif jika toko aktif memiliki entitlement.
- `src/lib/backup.ts`
  - Tambahkan metadata store pada backup dan restore guard.

### Worker

- `workers/api/src/routes/stores.ts`
  - Endpoint register idempotent untuk toko lokal.
  - Ownership check dan nama toko yang tervalidasi.
- `workers/api/src/routes/profile.ts`
  - Return kartu store lengkap dengan entitlement dan quota.
- `workers/api/src/routes/payments.ts`
  - Checkout tetap wajib `storeId`.
  - Tambahkan renewal per toko.
- `workers/api/src/routes/backups.ts`
  - Scope list/upload/download/delete/restore ke `storeId`.
- `workers/api/src/lib/lifecycle.ts`
  - Dunning per subscription dan per toko.
- `workers/api/src/lib/payments.ts`
  - Reconciliation untuk payment completed tanpa subscription.

### Supabase

- Pertahankan `subscriptions_active_store_uidx`.
- Tambahkan idempotency key register store bila diperlukan.
- Tambahkan ownership constraint untuk subscription/payment/store.
- Tambahkan status atau event log untuk expiry dan restore prompt.
- Jangan melakukan auto-migrasi `store_id = NULL` ke toko acak jika user memiliki
  lebih dari satu toko lokal.

## 8. Migrasi Subscription Legacy

Data legacy harus diproses aman:

1. Cari subscription dengan `store_id IS NULL`.
2. Jika user hanya memiliki satu toko lokal, tampilkan kandidat binding.
3. Jika user memiliki banyak toko, minta user memilih toko.
4. Tampilkan plan, tanggal expiry, dan payment reference sebelum konfirmasi.
5. Setelah konfirmasi, isi `subscriptions.store_id`.
6. Catat event audit migrasi.
7. Jangan membuat subscription kedua untuk periode yang sama.

Migrasi otomatis berdasarkan urutan nama atau toko pertama tidak boleh digunakan untuk
user multi-toko karena dapat mengaktifkan toko yang salah.

## 9. Acceptance Criteria

- Satu akun Google dapat menampilkan jumlah toko lokal/cloud sesuai kebutuhan tanpa
  batas jumlah toko dari plan cloud.
- Toko lokal yang sudah ada dapat didaftarkan ke cloud tanpa membuat DB lokal baru.
- User dapat memilih toko satu per satu untuk berlangganan.
- Lima toko aktif sebagai contoh menampilkan total biaya Rp 125.000 per bulan.
- Tiga toko aktif sebagai contoh menampilkan total biaya Rp 75.000 per bulan.
- Dua toko tanpa subscription tetap dapat dipakai offline.
- Setiap toko menampilkan expiry dan remaining quota sendiri.
- Upload backup toko A tidak masuk quota toko B.
- Sync toko A tidak memengaruhi toko B.
- Subscription expired tidak menghapus data lokal atau cloud store.
- Restore backup expired selalu meminta konfirmasi.
- Reaktivasi memakai cloud store yang sama.
- Subscription legacy tidak berpindah toko tanpa konfirmasi user.

## 10. Test Matrix

### Skenario multi-store

- Buat lima toko lokal sebagai fixture pengujian.
- Daftarkan tiga toko ke cloud.
- Pastikan dua toko tetap offline.
- Beli subscription untuk tiga toko.
- Cek tiga kartu aktif dan dua kartu offline.
- Ulangi dengan jumlah toko berbeda untuk memastikan tidak ada batas tersembunyi.

### Skenario quota

- Upload backup ke toko A.
- Pastikan quota toko B tidak berubah.
- Hapus backup toko A.
- Pastikan quota toko A kembali bertambah.

### Skenario expiry

- Set subscription toko A mendekati expiry pada database test.
- Pastikan warning hanya muncul pada toko A.
- Biarkan toko B tetap aktif.
- Expire toko A dan pastikan POS tetap berjalan offline.
- Restore backup terakhir dengan konfirmasi.
- Aktifkan ulang toko A dan pastikan `cloudStoreId` tidak berubah.

### Skenario satu akun

- Login akun Google yang sama pada dua device.
- Device A membuka toko cloud A.
- Device B membuka toko offline B.
- Pastikan data, backup, quota, dan subscription tidak tercampur.

## 11. Urutan Eksekusi

1. Perbaiki Cloud Hub agar menampilkan semua toko lokal tanpa batas jumlah.
2. Implementasikan register/link toko lokal ke cloud.
3. Tambahkan migrasi legacy subscription dengan konfirmasi.
4. Tampilkan state, expiry, quota, dan CTA per toko.
5. Implementasikan expiry prompt dan restore aman.
6. Tambahkan test matrix lima toko.
7. Uji di production memakai akun tester tanpa payment nyata.
8. Setelah smoke test lulus, lanjutkan hardening sync dan backup quota.

## 12. Non-Goal

- Tidak ada agregasi laporan lintas toko pada fase ini.
- Tidak ada transfer data otomatis antar toko.
- Tidak ada subscription global yang mengaktifkan semua toko.
- Tidak ada restore otomatis tanpa persetujuan user.
- Tidak ada penghapusan cloud store hanya karena subscription expired.
