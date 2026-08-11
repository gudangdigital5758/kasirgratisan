# Profitku Cloud - Rencana Migrasi Legacy dan Multi-Device

**Status:** Proposed
**Prioritas:** Critical
**Scope:** dua masalah production yang saling berhubungan:

1. Subscription lama masih berada pada level akun Google, bukan level toko.
2. Laptop dan HP memakai database lokal berbeda karena belum mengarah ke
   `cloudStoreId` yang sama.

## 1. Ringkasan Masalah

### Masalah A: subscription legacy

User lama dapat memiliki subscription aktif dengan kondisi:

```text
subscriptions.store_id = NULL
```

Status akun terlihat `Aktif`, tetapi entitlement per toko tidak aktif karena belum
ada toko cloud yang dituju.

Contoh:

```text
Akun: gsmgaleri@gmail.com
Subscription: aktif s/d 10 Sep 2026
Toko lokal: GSM Galeri
Cloud store: belum terhubung
```

Subscription lama tidak boleh dianggap hilang dan user tidak boleh membayar ulang.

### Masalah B: data laptop dan HP berbeda

Setiap device memiliki IndexedDB dan registry toko lokal sendiri. Login Google yang
sama hanya menyamakan identitas user, bukan isi IndexedDB.

Kondisi yang mungkin terjadi:

```text
Laptop: GSM Galeri -> localStoreKey laptop -> cloudStoreId kosong
HP:      GSM        -> localStoreKey HP      -> cloudStoreId kosong
```

Jika kedua device menekan `Daftarkan`, sistem dapat membuat dua cloud store berbeda.
Keduanya tidak akan pernah sync karena `storeId` berbeda.

## 2. Keputusan Produk

- Satu akun Google dapat memiliki toko dalam jumlah tidak terbatas.
- Satu toko cloud memiliki satu subscription sendiri.
- Harga satu toko: Rp 25.000 per bulan.
- Subscription legacy dipindahkan ke satu toko melalui konfirmasi user, tanpa biaya
  tambahan dan tanpa mengubah expiry.
- `cloudStoreId` adalah identitas global toko cloud.
- `storeKey` dan database IndexedDB adalah identitas lokal per device.
- Banyak device boleh terhubung ke satu `cloudStoreId`.
- Device kedua harus memilih `Hubungkan ke Cloud Store Existing`, bukan membuat store baru.
- POS lokal tidak boleh ditimpa otomatis ketika initial sync dilakukan.

## 3. Target State

```text
Akun Google yang sama
  |
  +-- GSM Galeri
  |     localStoreKey laptop -> cloudStoreId GSM-001
  |     localStoreKey HP     -> cloudStoreId GSM-001
  |     subscription aktif s/d 10 Sep 2026
  |
  +-- DNA
  |     offline atau cloudStoreId DNA-001
  |
  +-- DNA 2
        offline atau cloudStoreId DNA2-001
```

Data toko GSM dari laptop dan HP akan masuk ke scope cloud yang sama:

```text
sync_records.store_id = GSM-001
backups.store_id = GSM-001
subscriptions.store_id = GSM-001
```

## 4. Aturan Keselamatan Sebelum Migrasi

- Jangan tekan `Daftarkan` pada dua device untuk toko yang sama.
- Jangan menghapus IndexedDB laptop atau HP sebelum binding selesai.
- Jangan mengubah `subscriptions.store_id` secara manual tanpa inventory data.
- Jangan memindahkan backup `store_id = NULL` jika user memiliki beberapa toko dan
  asal backup tidak dapat dipastikan.
- Jangan melakukan initial pull yang langsung menimpa database lokal.
- Buat snapshot lokal sebelum operasi binding, restore, atau initial sync.

## 5. Fase 0 - Inventory Legacy Read-Only

Tujuan: mengetahui kondisi setiap user sebelum perubahan data.

Worker/admin membuat laporan:

- Subscription aktif dengan `store_id IS NULL`.
- Jumlah toko lokal tidak dapat dibaca server dan harus dikirim dari client saat wizard
  migrasi dibuka.
- Cloud store milik user yang sudah ada.
- Backup dengan `store_id IS NULL`.
- Backup dengan `store_id` tertentu.
- Payment completed yang belum memiliki `subscription_id`.
- Subscription/payment yang user-nya tidak sama dengan pemilik store.

Kategori hasil inventory:

| Kategori | Tindakan |
|---|---|
| 1 legacy sub + 1 toko lokal | Tawarkan binding langsung dengan konfirmasi |
| 1 legacy sub + banyak toko lokal | User memilih toko target |
| Legacy sub + cloud store existing | Tawarkan pilih cloud store existing |
| Backup legacy tunggal | Boleh dipindahkan setelah konfirmasi |
| Banyak backup legacy ambigu | Pertahankan sebagai legacy recovery bucket |
| Tidak ada subscription | Alur register dan checkout normal |

## 6. Fase 1 - Migrasi Subscription Lama

### UI migration banner

Cloud Hub menampilkan banner:

```text
Subscription Cloud lama ditemukan
Berlaku s/d 10 Sep 2026
Hubungkan ke toko agar backup dan sinkronisasi aktif.

[Hubungkan ke GSM Galeri]
```

Jika ada lebih dari satu toko:

```text
Pilih toko tujuan subscription lama:
( ) GSM Galeri
( ) DNA
( ) DNA 2

[Konfirmasi]
```

### Endpoint/RPC

Tambahkan endpoint:

```text
POST /api/stores/claim-legacy-subscription
```

Body:

```json
{
  "storeId": "cloud-store-uuid",
  "localStoreKey": "device-local-key",
  "moveLegacyBackups": true
}
```

Worker harus:

1. Memvalidasi user OAuth.
2. Memvalidasi ownership `storeId` bila cloud store sudah ada.
3. Mengunci subscription legacy yang dipilih.
4. Menolak claim jika subscription sudah terikat ke toko lain.
5. Mengisi `subscriptions.store_id` tanpa mengubah period end.
6. Memindahkan backup legacy hanya jika policy mengizinkan.
7. Mencatat event migrasi.
8. Mengembalikan entitlement toko terbaru.

Operasi harus idempotent. Retry request yang sama tidak boleh membuat subscription,
cloud store, atau backup kedua.

### Jika cloud store belum ada

Gunakan transaksi server atau dua langkah dengan idempotency key:

1. Create cloud store dengan `registrationKey`.
2. Claim subscription legacy ke cloud store tersebut.
3. Return cloud store dan entitlement.

Jika langkah kedua gagal, cloud store tetap ditandai sebagai `pending_claim` dan dapat
dilanjutkan, bukan dibuat ulang.

## 7. Fase 2 - Hubungkan Device Kedua ke Cloud Store Existing

### UI device kedua

Jika user login dan server memiliki cloud store:

```text
Toko lokal GSM
Cloud store milik akun ditemukan:

GSM Galeri
Berlaku s/d 10 Sep 2026

[Hubungkan ke GSM Galeri]
```

Tombol `Daftarkan` hanya ditampilkan jika user benar-benar ingin membuat cloud store
baru dan tidak ada cloud store existing yang cocok.

### Endpoint

Tambahkan endpoint:

```text
POST /api/stores/:id/bind-device
```

Body:

```json
{
  "localStoreKey": "device-local-key",
  "deviceId": "device-uuid",
  "deviceName": "Android Daniel"
}
```

Server hanya mencatat device dan mengembalikan metadata store. `localStoreKey` tidak
boleh dijadikan cloud identity karena nilainya berbeda antar-device.

### Initial sync device kedua

Sebelum initial pull:

1. Deteksi apakah database lokal target kosong.
2. Jika kosong, pull cloud snapshot ke database lokal.
3. Jika tidak kosong, buat snapshot lokal.
4. Tampilkan perbandingan tanggal perubahan lokal dan cloud.
5. User memilih `Gunakan Data Cloud`, `Pertahankan Lokal`, atau `Review Konflik`.
6. Terapkan pilihan dalam transaksi Dexie.
7. Simpan cursor sync setelah apply berhasil.

Default yang paling aman untuk device baru adalah `Gunakan Data Cloud` hanya jika
database lokal memang kosong.

## 8. Fase 3 - Data Conflict dan Source of Truth

### Database lokal kosong

- Cloud menjadi sumber initial state.
- Pull semua record yang diizinkan.
- Terapkan tanggal sebagai `Date`.
- Rebuild relasi numeric lokal dari `syncId`.

### Database lokal memiliki data

- Jangan melakukan overwrite otomatis.
- Backup lokal dibuat sebelum merge.
- Record yang memiliki `syncId` sama diproses dengan LWW.
- Record tanpa `syncId` dianggap local-only dan ditampilkan untuk review.
- Transaction, stock lot, dan allocation harus memiliki aturan khusus agar tidak
  menghasilkan stok ganda.

### Credential lokal

- Jangan sync `users.pinHash` sebagai bagian initial pull.
- User lokal pada device kedua harus dibuat ulang atau menggunakan mekanisme auth toko
  yang terpisah.
- Login Google cloud tidak boleh dianggap sama dengan login PIN kasir lokal.

## 9. Perubahan Frontend

- `src/pages/settings/CloudHub.tsx`
  - Tampilkan cloud stores milik akun dan local stores pada device.
  - Tampilkan CTA `Hubungkan Existing` jika ada cloud store matching.
  - Tampilkan migration banner untuk legacy subscription.
  - Jangan menampilkan status akun global sebagai status toko.
- `src/pages/settings/CloudStoreSettings.tsx`
  - Tambahkan halaman binding/migration per toko.
  - Tampilkan device yang terhubung ke cloud store.
- `src/lib/store-registry.ts`
  - Helper `bindLocalStoreToCloudStore` yang idempotent.
  - Helper untuk membedakan `storeKey` lokal dan `cloudStoreId` global.
- `src/lib/cloud-api.ts`
  - Tambahkan `claimLegacySubscription()`.
  - Tambahkan `bindDeviceToCloudStore()`.
  - Tambahkan `fetchCloudStoreState()`.
- `src/lib/sync.ts`
  - Initial pull wizard.
  - Guard database kosong/non-kosong.
  - Cursor hanya maju setelah apply berhasil.
- `src/lib/backup.ts`
  - Snapshot lokal sebelum initial pull/restore.
  - Validasi target `cloudStoreId`.

## 10. Perubahan Worker dan Supabase

- `workers/api/src/routes/stores.ts`
  - Endpoint bind existing cloud store.
  - Idempotency key registration.
  - Device registration dan ownership check.
- `workers/api/src/routes/profile.ts`
  - Return `legacyMigrationRequired` dan kandidat store.
- `workers/api/src/routes/payments.ts`
  - Tidak membuat subscription baru ketika migration claim dipilih.
- `workers/api/src/routes/backups.ts`
  - Policy backup legacy dan migration audit.
- `workers/api/src/routes/sync.ts`
  - Device binding harus memakai cloud store milik user.
- `supabase/migrations/*`
  - Tambah idempotency/claim record jika diperlukan.
  - Tambah audit event migrasi.
  - Pertahankan unique active subscription per store.

## 11. Skenario GSM Production

### Kondisi awal

```text
Laptop: GSM Galeri, data utama, cloudStoreId kosong
HP: GSM, data berbeda, cloudStoreId kosong
Akun: subscription legacy aktif s/d 10 Sep 2026
```

### Hasil yang diinginkan

```text
Cloud store: GSM Galeri, satu ID global
Subscription: store_id = GSM Galeri, expiry tetap 10 Sep 2026
Laptop: bind ke GSM Galeri
HP: bind ke GSM Galeri
Data: konvergen setelah initial pull dan auto-sync
```

### Langkah eksekusi

1. Backup lokal laptop dan HP.
2. Jalankan migration banner pada laptop.
3. Claim subscription lama ke cloud store GSM Galeri.
4. Upload backup awal laptop sebagai kandidat source of truth.
5. Login akun yang sama pada HP.
6. Pilih `Hubungkan ke GSM Galeri`, bukan `Daftarkan`.
7. Jika DB HP berbeda, tampilkan pilihan merge/replace.
8. Pull initial dari cloud.
9. Uji edit produk dari laptop ke HP.
10. Uji transaksi offline dari HP lalu retry ke cloud.
11. Pastikan tidak ada cloud store GSM duplicate.

## 12. Skenario DNA dan DNA 2

- DNA dan DNA 2 tetap dapat offline tanpa subscription.
- Jika ingin cloud, masing-masing didaftarkan ke cloud store berbeda.
- Tidak boleh memakai `cloudStoreId` GSM untuk DNA atau DNA 2.
- Satu akun Google tetap dapat mengelola semua toko tanpa batas jumlah.
- Setiap kartu menampilkan status dan quota sendiri.

## 13. Acceptance Criteria

- Subscription lama GSM dapat dipindahkan ke GSM tanpa pembayaran ulang.
- Expiry legacy tetap sama setelah claim.
- Laptop dan HP memakai `cloudStoreId` GSM yang identik.
- Device kedua tidak membuat cloud store duplicate.
- Data cloud GSM dapat dipull ke device kedua dengan pilihan restore aman.
- Data lokal yang berbeda tidak ditimpa tanpa konfirmasi.
- Sync produk, stok, dan transaksi berjalan pada cloud store yang sama.
- DNA dan DNA 2 tetap terisolasi dari GSM.
- User dapat menambah toko baru tanpa batas jumlah.
- Subscription expired menghentikan cloud operation tetapi tidak menghapus data lokal.

## 14. Test Matrix

### Legacy subscription

- Satu legacy subscription dan satu toko lokal.
- Satu legacy subscription dan tiga toko lokal.
- Legacy subscription sudah expired.
- Legacy subscription sudah pernah di-claim.
- Retry claim dua kali.

### Multi-device

- Device A dan B login akun Google sama.
- Device A dan B bind cloud store yang sama.
- Device B database kosong.
- Device B database memiliki data berbeda.
- Device A offline membuat transaksi.
- Device B mengedit produk yang sama.
- Delete/tombstone dari device A ke device B.

### Isolation

- GSM upload backup tidak mengubah quota DNA.
- DNA sync tidak mengubah data GSM.
- Device tidak dapat bind cloud store milik user lain.
- Register retry tidak membuat cloud store duplicate.

## 15. Rollout dan Rollback

### Rollout

1. Deploy API migration dan endpoint dalam keadaan feature flag off.
2. Aktifkan migration banner hanya untuk akun legacy tester.
3. Uji GSM pada laptop dan HP.
4. Aktifkan link existing cloud store untuk user bertahap.
5. Monitor duplicate store, failed claim, sync error, dan restore error.

### Rollback

- Nonaktifkan migration banner dan endpoint claim baru.
- Jangan membalik `subscriptions.store_id` otomatis.
- Pertahankan cloud store dan backup hasil migration.
- Restore hanya dari audit log dan backup database setelah review manual.

## 16. Non-Goal

- Tidak ada auto-merge tanpa snapshot dan konfirmasi.
- Tidak ada penghapusan data lokal saat binding device.
- Tidak ada pemindahan subscription legacy ke toko acak.
- Tidak ada subscription global yang mengaktifkan seluruh toko.
- Tidak ada batas lima toko pada akun Google.
