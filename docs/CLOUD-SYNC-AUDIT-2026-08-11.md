# Audit Cloud dan Sinkronisasi Antar-Perangkat - 2026-08-11

> Audit read-only terhadap fungsi Cloud Hub, Kelola Toko, backup cloud, dan
> sinkronisasi lintas perangkat. Dokumen ini memuat kondisi aktual kode dan
> rencana remediation yang harus diselesaikan sebelum sync dibuka untuk rollout
> luas.

## 1. Metadata Audit

| Item | Nilai |
|---|---|
| Tanggal | 2026-08-11 |
| Branch | `main` |
| Jenis | Audit kode, arsitektur, data flow, security, dan test coverage |
| Scope frontend | `CloudHub`, `CloudStoreSettings`, `StoresManager`, `sync.ts`, backup, auth lokal |
| Scope backend | Worker routes sync/stores/backups/profile, Supabase RPC dan migration |
| Scope dokumen | `SYNC-DESIGN.md`, `SYNC-QA.md`, `CLOUD-IMPLEMENTATION-PLAN.md`, `DECISIONS.md` |
| Perubahan kode | Tidak ada; audit bersifat read-only |

### Verifikasi yang dilakukan

- `npm test`: 20 file dan 114 test lulus.
- Test sync terpilih: 5 file dan 20 test lulus.
- `npm run typecheck`: lulus.
- `workers/api` `npm run typecheck`: lulus.
- `npm run lint`: 0 error dan 25 warning.
- `git diff --check`: bersih.
- Tidak ditemukan test Worker/Supabase/R2 integration.

## 2. Ringkasan Eksekutif

Profitku memiliki dua operasi cloud yang berbeda tetapi memakai label yang mirip:

1. Operasi pada blok **Kelola Toko** dengan tombol `Sync Sekarang` adalah upload
   snapshot backup JSON penuh ke R2.
2. Operasi pada blok **Sinkronisasi Antar-Perangkat** adalah push/pull record
   lokal menggunakan Last-Write-Wins (LWW) dan tombstone.

Baseline sync untuk record sederhana seperti produk sudah berjalan dan test
simulasi dua perangkat lulus. Namun implementasi belum aman untuk keseluruhan
data POS dan belum memenuhi acceptance criteria pada `CLOUD-IMPLEMENTATION-PLAN.md`.

Risiko utama:

- Toko aktif dapat terhapus permanen melalui jalur Kelola Toko.
- Database lokal dapat dibind ke cloud store yang salah dan mencampur data antar toko.
- Item transaksi, alokasi FIFO, stock opname item, dan role belum memiliki pipeline sync lengkap.
- Pull lebih dari 5.000 perubahan dapat melewati data secara permanen karena tidak ada pagination.
- `users.pinHash` dan credential lokal ikut masuk ke payload sync dan backup cloud.
- Initial sync dapat terblokir tanpa UI untuk memilih sumber data.

Kesimpulan: fitur sync sebaiknya tetap berada di rollout terbatas atau dinonaktifkan
sementara melalui `SYNC_ENABLED=false` sampai temuan P0 ditutup dan acceptance test
perangkat nyata lulus.

## 3. Fungsi Aktual Sistem

### 3.1 Blok Kelola Toko dan backup cloud

File utama: `src/pages/settings/CloudHub.tsx`,
`src/pages/settings/CloudStoreSettings.tsx`, `src/lib/backup.ts`,
`workers/api/src/routes/backups.ts`.

#### Dropdown toko

Dropdown di `CloudHub.tsx:627-671` memilih cloud store yang akan diikat ke
database lokal aktif. Perubahan tersebut hanya menulis:

```text
local IndexedDB storeSettings.cloudStoreId = cloudStoreId
```

Dropdown ini bukan store switcher. Pergantian database lokal dilakukan melalui
registry `kasirgratisan-stores`, `setActiveStoreKey()`, dan reload aplikasi.

#### Tombol `Sync Sekarang` pada blok Kelola Toko

Implementasi `CloudHub.tsx:397-415` menjalankan:

1. `buildBackupJsonString()` mengambil seluruh tabel lokal.
2. JSON dikirim melalui `POST /api/backups`.
3. Worker menulis object ke R2 dan metadata ke Supabase.
4. `lastCloudBackupAt` diperbarui di IndexedDB lokal.

Isi snapshot diambil melalui `src/lib/backup.ts:18-45`, termasuk produk,
transaksi, item transaksi, stock lots, users, roles, store settings, dan
`deletedRecords`.

Operasi ini bersifat recovery backup. Operasi ini tidak mengubah `sync_records`
dan tidak membuat perangkat lain menerima perubahan secara record-level.

#### Halaman Kelola Toko

`CloudStoreSettings.tsx` menyediakan:

- Daftar cloud store milik akun.
- Pembuatan cloud store.
- Binding device ke cloud store.
- Subscription dan renewal 1, 6, atau 12 bulan.
- Quota storage dan tanggal expiry per toko.
- Download backup terakhir saat subscription expired.
- Rename dan delete cloud store.

Sebagian operasi di atas belum konsisten dengan route Worker dan keputusan
produk. Detailnya ada di daftar temuan.

### 3.2 Sinkronisasi Antar-Perangkat

File utama: `src/lib/sync.ts`, `src/hooks/use-cloud-auto-backup.ts`,
`workers/api/src/routes/sync.ts`, `workers/api/src/routes/helpers.ts`, dan
RPC `sync_upsert_batch`.

#### Pipeline manual

`syncNow()` pada `src/lib/sync.ts:186-232` melakukan:

1. Membaca `cloudStoreId` dari `storeSettings` lokal.
2. Menolak sync jika `initialSyncRequired` masih aktif.
3. Mengumpulkan record dengan `syncedAt` kosong.
4. Mengumpulkan tombstone dari `deletedRecords`.
5. Push ke `/api/sync/push`.
6. Menandai record sebagai synced berdasarkan daftar acknowledgement.
7. Pull dari `/api/sync/pull` memakai `lastPullCursor`.
8. Menerapkan record dan tombstone ke IndexedDB.
9. Menyimpan cursor, last sync, error, dan conflict count di `syncMeta`.

#### Auto-sync

Auto-sync dijalankan oleh `useCloudAutoBackup.ts` ketika user login dan entitlement
toko aktif. Pemicu yang tersedia:

- App dibuka.
- Browser kembali online.
- Tab kembali terlihat.
- Interval setiap lima menit.

Jadwal yang dipilih pada halaman `CloudAutoBackupSettings` sebenarnya mengatur
jadwal backup cloud. Cross-device sync tetap dipicu otomatis setiap lima menit
selama entitlement aktif.

### 3.3 Server-side scope

Worker memvalidasi:

- Bearer token Supabase.
- Kepemilikan `storeId`.
- Entitlement `has_sync` per toko.
- Rate limit request.

Supabase menyimpan sync mirror pada `sync_records` dengan key:

```text
(store_id, table_name, sync_id)
```

Backup cloud menggunakan metadata Supabase dan object R2. Backup dan sync
memiliki tujuan berbeda dan tidak boleh dijelaskan sebagai operasi yang sama.

## 4. Penjelasan Status pada Screenshot

Status berikut berasal dari sumber data yang berbeda:

| Tampilan | Sumber | Makna aktual |
|---|---|---|
| `Terakhir sync` pada Kelola Toko | `storeSettings.lastCloudBackupAt` | Upload backup JSON terakhir |
| `Terakhir sync data` | `syncMeta.lastSyncAt` | Pull sync record terakhir yang selesai |
| `N perubahan menunggu sinkronisasi` | `countPendingChanges()` | Record/tombstone dengan `syncedAt` kosong |
| `Sync terakhir gagal` | `syncMeta.lastSyncError` | Error pipeline push atau pull terakhir |

Pesan `Tidak ada record valid untuk di-push` muncul ketika client memiliki
record dirty, tetapi Worker membuang seluruh item karena `syncId` atau field
wajib lainnya tidak valid. Kondisi ini dapat terjadi pada `transactionItems`,
`stockOpnameItems`, dan `roles` yang dibuat tanpa hook sync lengkap.

## 5. Daftar Temuan Audit

Severity yang dipakai:

- **P0**: risiko kehilangan data, pencampuran data, atau kebocoran credential.
- **P1**: fungsi utama tidak reliable atau melanggar kontrak arsitektur.
- **P2**: ketidaksesuaian UX, status, atau maintainability yang tidak langsung merusak data.

| ID | Severity | Temuan | Dampak utama |
|---|---|---|---|
| CLOUD-001 | P0 | Toko aktif dapat dihapus melalui Kelola Toko | Data lokal dan cloud hilang permanen |
| CLOUD-002 | P0 | Binding cloud store tidak menyamakan registry dan `storeSettings` | Data toko dapat masuk ke cloud store yang salah |
| CLOUD-003 | P0 | Tabel relasional sync belum lengkap | Transaksi, FIFO, opname, dan role tidak konvergen |
| CLOUD-004 | P0 | Pull tidak memiliki pagination/cursor lanjutan | Perubahan di atas 5.000 record dapat hilang dari device |
| CLOUD-005 | P0 | Credential lokal ikut sync dan backup | Kebocoran hash PIN dan login device lain gagal |
| CLOUD-006 | P1 | Initial sync tidak memiliki pemilihan sumber data | Device dapat terblokir atau melakukan merge yang salah |
| CLOUD-007 | P1 | Restore tidak memvalidasi target `storeId` | Backup toko A dapat menimpa database toko B |
| CLOUD-008 | P1 | LWW mempercayai timestamp client dan payload arbitrary | Clock skew, field ilegal, dan payload berbahaya |
| CLOUD-009 | P1 | Tidak ada mutex, queue, dan apply transaction | Race condition dan partial apply |
| CLOUD-010 | P1 | Tombstone child record tidak lengkap | Item/alokasi lama tetap hidup di device lain |
| CLOUD-011 | P1 | Quota backup racy dan scan terbatas | Quota dapat terlewati atau salah dihitung |
| CLOUD-012 | P1 | Route rename toko tidak tersedia di Worker | Rename selalu gagal dari frontend |
| CLOUD-013 | P1 | Legacy subscription otomatis dibind ke toko pertama | Entitlement dapat masuk ke toko yang salah |
| CLOUD-014 | P2 | Status dan kontrak UI cloud membingungkan | User mengira backup sama dengan sync |
| CLOUD-015 | P2 | Status per toko masih tercampur dengan status akun | Expiry dan subscription toko dapat ditampilkan salah |

### CLOUD-001 - Toko aktif dapat dihapus

Lokasi: `src/pages/settings/CloudStoreSettings.tsx:216-235`.

`handleDelete()` tidak memiliki guard terhadap `activeStoreId`. Fungsi tersebut
memanggil `DELETE /api/stores/:id`, membersihkan binding, lalu memanggil
`removeStoreByCloudId()` yang dapat menghapus database IndexedDB toko.

`StoresManager` memang menyembunyikan delete untuk toko aktif, tetapi Kelola
Toko menjadi jalur bypass. Hal ini bertentangan dengan `DECISIONS.md:440-443`.

### CLOUD-002 - Binding store tidak atomik dan tidak konsisten

Lokasi: `CloudHub.tsx:254-258`, `CloudStoreSettings.tsx:108-117`,
`src/lib/store-registry.ts:120-139`.

Binding langsung mengubah `storeSettings.cloudStoreId`, tetapi tidak selalu
memperbarui entry registry `cloudStoreId` dan `mode`. Sebagian kode membaca
registry, sedangkan `syncNow()` membaca `storeSettings`.

Jika database lokal A dibind ke cloud store B, data lokal A dapat dipush ke B.
Tidak ada snapshot otomatis, konfirmasi sumber data, atau validasi bahwa cloud
store tersebut memang pasangan database lokal yang dimaksud.

### CLOUD-003 - Tabel child dan relasi belum sync-complete

Lokasi: `src/lib/sync.ts:15-20`, `src/lib/db.ts:121-203`,
`src/lib/cashier-ops.ts:120-143`, `src/pages/settings/StockOpname.tsx:122-130`.

`SYNC_TABLES` memasukkan `transactionItems`, `stockOpnameItems`, dan `roles`,
tetapi `setupSyncHooks()` tidak memasang hook pada seluruh tabel tersebut.
Record baru dapat tidak memiliki `syncId`, `updatedAt`, atau `syncedAt`.

Worker membuang item tanpa `syncId` di `workers/api/src/routes/helpers.ts:118-145`.
Karena itu header transaksi dapat tersinkron tanpa detail item. Penghapusan
item transaksi dan stock allocation juga tidak menghasilkan tombstone yang
dapat diterapkan di device lain.

### CLOUD-004 - Pull terpotong tanpa pagination

Lokasi: `workers/api/src/routes/sync.ts:29-46` dan `src/lib/sync.ts:211-223`.

Worker mengembalikan maksimal 5.000 row, tetapi response tidak memiliki
`nextCursor`. Client menyimpan `serverTime` sebagai cursor walaupun masih ada
row yang belum dikirim. Row yang terlewat dapat tidak pernah dipull lagi.

### CLOUD-005 - Credential lokal masuk cloud

Lokasi: `src/lib/sync.ts:15-20`, `src/lib/sync.ts:63-72`,
`src/lib/auth.ts:8-15`, `src/lib/backup.ts:18-45`.

Tabel `users` masuk daftar sync dan data dikirim tanpa allowlist field. Ini
termasuk `pinHash`. Backup JSON juga memuat users dan store settings.

Hash PIN menggunakan `deviceId` sebagai salt. Hash dari device A tidak cocok
dengan `deviceId` device B, sehingga login lokal yang ikut tersinkron tidak
memiliki perilaku yang benar. Selain itu, hash credential tidak seharusnya
menjadi bagian dari cloud payload tanpa desain auth toko khusus.

### CLOUD-006 - Initial sync tidak memiliki source selection

Lokasi: `CloudHub.tsx:221-239` dan `src/lib/sync.ts:195-198`.

Saat local data dan remote data sama-sama ada, client menyimpan
`initialSyncRequired=true`. Namun tidak ada UI untuk memilih `Gunakan Data Cloud`,
`Pertahankan Lokal`, atau `Review Konflik`.

Heuristik `productCount > 0 || transactionCount > 0` juga mengabaikan kategori,
payment method, roles, stock lots, dan data lain. Database yang tampak kosong
dapat tetap mendorong default local data ke cloud store existing.

### CLOUD-007 - Restore tidak scoped ke target toko

Lokasi: `src/pages/settings/CloudBackupsListSettings.tsx:64-75`,
`src/lib/cloud-api.ts:393-398`, `workers/api/src/routes/backups.ts:176-189`.

List backup memang memakai filter toko aktif, tetapi endpoint download hanya
memeriksa backup milik user. Tidak ada validasi bahwa backup dan database lokal
memiliki `storeId` yang sama sebelum restore.

### CLOUD-008 - LWW dan payload belum di-hardening

Lokasi: `20260805120000_sync.sql:57-73` dan
`workers/api/src/routes/helpers.ts:118-145`.

Server menyimpan timestamp yang dikirim client sebagai `server_updated_at`.
Device dengan jam maju dapat memenangkan konflik. Worker juga belum memiliki:

- Allowlist field per tabel.
- Batas ukuran byte request.
- Batas panjang string dan ukuran foto.
- Validasi UUID untuk semua sync ID.
- Acknowledgement berbasis revision/hash.

RPC mengembalikan daftar `sync_id` untuk setiap item walaupun item tersebut
lebih lama dari versi yang sudah ada. Client belum menerima informasi versi
server yang sebenarnya menang.

### CLOUD-009 - Tidak ada mutex, queue, dan apply transaction

Lokasi: `src/lib/sync.ts:200-223`, `src/lib/sync.ts:129-182`,
`src/hooks/use-cloud-auto-backup.ts:98-115`.

Tombol manual, event online, visibility, dan interval dapat memanggil sync
bersamaan. Push/pull dapat overlap. Apply pull dilakukan per record tanpa satu
transaksi Dexie, sehingga error di tengah proses dapat meninggalkan partial state.

Belum ada persistent `syncQueue`, backoff retry, atau status batch per toko.

### CLOUD-010 - Tombstone child tidak lengkap

Lokasi: `src/lib/db.ts:176-200`, `src/lib/cashier-ops.ts:267-269`,
`src/lib/inventory.ts:327-329`.

Tombstone hard-delete dibuat dengan `setTimeout()` di luar transaksi. Hook juga
hanya terpasang pada beberapa tabel. Penghapusan transaction item dan stock lot
allocation tidak tercatat sebagai tombstone.

Device lain dapat mempertahankan item transaksi atau allocation lama walaupun
header transaksi telah dihapus atau diedit.

### CLOUD-011 - Quota backup belum atomic

Lokasi: `workers/api/src/lib/backups.ts:87-90` dan
`workers/api/src/routes/backups.ts:124-135`.

Quota dihitung dengan scan metadata maksimal 500 row dan tidak dikunci bersama
operasi upload. Upload concurrent dapat melewati quota. Cleanup retention juga
memakai batas page tanpa mekanisme melanjutkan seluruh halaman.

### CLOUD-012 - Rename route Worker hilang

Frontend memanggil `PUT /api/stores/:id` melalui `renameStore()` di
`src/lib/cloud-api.ts:632-640`. Namun `workers/api/src/routes/stores.ts`
hanya memiliki GET, POST, claim legacy, bind device, dan DELETE.

Akibatnya tombol rename di Kelola Toko tidak dapat berhasil.

### CLOUD-013 - Legacy subscription otomatis memilih toko pertama

Lokasi: `supabase/migrations/20260808150000_per_store_subscription.sql:174-185`.

Migration mengisi `subscriptions.store_id` dengan cloud store paling awal untuk
setiap user. Ini tidak sama dengan rencana migrasi eksplisit pada
`docs/CLOUD-LEGACY-MIGRATION-MULTI-DEVICE-PLAN.md`, yang meminta user memilih
toko target dan menghindari binding acak.

### CLOUD-014 - Istilah UI backup dan sync bercampur

Lokasi: `CloudHub.tsx:397-415`, `CloudHub.tsx:691-724`,
`use-cloud-auto-backup.ts:53-64`.

Tombol backup memakai label `Sync Sekarang`, sedangkan sync record juga memakai
label yang sama. `lastCloudBackupAt` ditampilkan sebagai last sync.

Keputusan baru di `DECISIONS.md:410-427` menyebut auto-sync tanpa tombol manual,
tetapi UI dan `SYNC-QA.md:23-25` masih mengandalkan tombol manual. Kontrak
produk perlu diputuskan dan diselaraskan.

### CLOUD-015 - Status per toko dan akun masih bercampur

Lokasi: `workers/api/src/routes/profile.ts:101-129`,
`src/hooks/use-cloud-auth.tsx:171-183`, dan `CloudHub.tsx:417-428`.

Profile hanya menyimpan satu `syncSubscription` walaupun user dapat memiliki
beberapa subscription per toko. Nilai tersebut dapat tertimpa oleh subscription
lain dalam loop. UI dapat menampilkan expiry atau plan toko yang tidak sedang
dipilih.

## 6. Root Cause Matrix

| Area | Root cause | Konsekuensi |
|---|---|---|
| Store identity | `cloudStoreId`, `storeKey`, dan DB lokal belum memiliki helper binding tunggal | Scope data dapat berbeda antar modul |
| Sync schema | Hook dan metadata child table belum lengkap | Dirty row invalid dan relasi orphan |
| Protocol | Cursor sederhana berbasis waktu dan limit hardcoded | Pull tidak reliable pada volume besar |
| Security | Payload arbitrary dan users ikut sync | Credential exposure dan field injection |
| Initial state | Tidak ada source-selection workflow | Device baru dapat overwrite atau terblokir |
| Backup | Quota scan bukan ledger atomic | Race dan perhitungan quota salah |
| Frontend state | Status sync dibaca sekali dan profile agregat | UX tidak mencerminkan state per toko |
| Test strategy | Tidak ada Worker/Supabase/R2 integration test | Bug boundary tidak terdeteksi CI |

## 7. Prinsip Remediation

1. POS offline tidak boleh terblokir oleh API cloud gagal.
2. `cloudStoreId` adalah scope global cloud; `storeKey` hanya identitas lokal device.
3. Setiap operasi per toko harus memvalidasi ownership dan entitlement server-side.
4. Tidak ada operasi binding, restore, atau initial sync tanpa source-of-truth yang jelas.
5. Credential PIN lokal dan `deviceId` tidak boleh menjadi data sync antar-device.
6. Sync harus fail-closed: tidak ada `syncedAt` atau cursor maju tanpa acknowledgement dan apply yang berhasil.
7. Backup dan sync harus memiliki istilah, status, endpoint, dan acceptance test yang berbeda.
8. Perubahan schema sync harus backward-compatible dengan database Dexie existing.

## 8. Rencana Perbaikan Bertahap

### Phase 0 - Containment dan perlindungan data

Prioritas: segera, sebelum rollout tambahan.

#### Perubahan

- Set `SYNC_ENABLED=false` di production atau batasi hanya untuk tester internal.
- Sembunyikan atau disable delete active store pada semua jalur frontend.
- Tambahkan guard Worker yang menolak delete bila toko masih menjadi active binding
  pada request yang relevan, atau jadikan delete cloud tidak otomatis menghapus
  DB lokal.
- Hentikan auto-backfill legacy subscription baru sampai inventory user selesai.
- Ambil snapshot lokal sebelum operasi binding, restore, dan initial sync.
- Tampilkan peringatan bahwa backup cloud tidak sama dengan cross-device sync.

#### Exit criteria

- Toko aktif tidak dapat dihapus dari CloudHub maupun StoresManager.
- Production tidak menerima push/pull dari user umum selama P0 belum selesai.
- Tidak ada operasi migrasi legacy tambahan tanpa audit inventory.

### Phase 1 - Store identity, binding, deletion, dan restore safety

Prioritas: P0.

#### Perubahan

- Buat helper `bindLocalStoreToCloudStore()` yang memperbarui secara konsisten:
  `storeRegistry.stores`, `storeSettings.cloudStoreId`, dan `store.mode`.
- Bedakan secara eksplisit tiga operasi:
  1. Switch database lokal.
  2. Bind database lokal ke cloud store existing.
  3. Register cloud store baru.
- Binding harus memvalidasi ownership, menyimpan snapshot lokal, dan meminta user
  memilih sumber data bila database target tidak kosong.
- Panggil `bind-device` secara konsisten setelah binding berhasil.
- Tambahkan `storeId` target pada download dan restore backup.
- Worker wajib memvalidasi backup owner dan `backup.store_id` terhadap target store.
- Tambahkan guard UUID pada semua route store, backup, sync, payment, dan ID metadata.
- Implementasikan `PUT /api/stores/:id` atau hapus tombol rename sampai route tersedia.
- Pastikan delete cloud store tidak menghapus database aktif secara otomatis.
- Jika penghapusan lokal memang dipilih, minta konfirmasi kedua dan reload secara deterministik.

#### Exit criteria

- Binding pada device A dan B ke cloud store yang sama menghasilkan `cloudStoreId` identik.
- Binding ke cloud store lain dalam akun yang sama tidak dapat mengirim data ke scope yang salah.
- Restore backup toko A ke toko B ditolak.
- Rename toko berhasil dan diuji pada Worker route nyata.
- Delete toko aktif ditolak pada semua UI path dan API path.

### Phase 2 - Sync data model dan credential boundary

Prioritas: P0.

#### Perubahan

- Tetapkan allowlist tabel dan field yang boleh masuk `sync_records`.
- Jangan sync `users.pinHash`, `storeSettings.deviceId`, session, atau credential lokal.
- Putuskan desain user antar-device:
  - user kasir dibuat ulang per device, atau
  - gunakan auth toko server-side yang memang dirancang untuk multi-device.
- Tambahkan kolom dan hook konsisten untuk:
  `transactionItems`, `stockOpnameItems`, `roles`, `stockLotAllocations`,
  serta tabel child lain yang masuk scope.
- Pastikan setiap record baru mendapat `syncId`, `updatedAt`, dan `syncedAt`.
- Tambahkan dual relation sync ID untuk semua foreign key lintas-device.
- Buat tombstone untuk delete item transaksi, allocation, opname item, dan role.
- Tambahkan migrasi backfill untuk record existing tanpa sync metadata.
- Jangan sync `storeSettings` sebagai record biasa tanpa keputusan khusus karena
  sebagian field bersifat device-specific.

#### Exit criteria

- Checkout transaksi baru di device A menghasilkan header, item, FIFO lot, dan
  allocation yang dapat direkonstruksi di device B.
- Edit dan delete item transaksi menyebar dengan benar.
- Stock opname dan role tidak menghasilkan `syncId` kosong.
- Tidak ada `pinHash`, session key, atau device credential dalam push/pull payload.
- Semua field server yang diterima sesuai allowlist.

### Phase 3 - Protocol reliability dan conflict handling

Prioritas: P0/P1.

#### Perubahan

- Ganti pull limit sederhana dengan keyset cursor stabil, misalnya kombinasi:
  `(server_updated_at, sync_record_id)`.
- Response pull harus memiliki `nextCursor`, `hasMore`, dan jumlah batch.
- Cursor client hanya maju setelah seluruh batch berhasil diterapkan.
- Gunakan server receive time dengan aturan clock skew yang eksplisit.
- Acknowledgement push harus mengembalikan revision atau server winner per record.
- Tambahkan validasi body size, record count, field length, array depth, dan foto.
- Tambahkan mutex per `storeId` agar push/pull tidak overlap.
- Buat persistent queue per toko dengan status pending, retry count, dan backoff.
- Terapkan pull dalam satu transaksi Dexie atau mekanisme batch yang atomic.
- Normalisasi seluruh field tanggal menjadi `Date` sebelum data dibaca UI.
- Resolve foreign key dalam dua pass agar parent yang datang belakangan tetap terhubung.
- Tentukan retention tombstone agar delete lama tidak menghidupkan record lama.

#### Exit criteria

- 5.001+ perubahan dapat dipull sampai selesai tanpa record terlewat.
- Push dan pull concurrent tidak merusak cursor atau dirty state.
- Sync gagal di tengah apply tidak menghasilkan partial state yang dianggap sukses.
- Clock device maju tidak dapat memenangkan LWW tanpa aturan server.
- Record baru yang diedit selama push tidak ikut salah ditandai synced.

### Phase 4 - Backup, quota, dan retention

Prioritas: P1.

#### Perubahan

- Ganti scan quota dengan RPC atau ledger atomic per `storeId`.
- Tambahkan idempotency key upload agar retry tidak membuat snapshot ganda.
- Pastikan semua list, cleanup, dan delete memproses pagination penuh.
- Masukkan `storeId` pada R2 key sesuai kontrak target:
  `backups/{userId}/{storeId}/{uuid}-{safeFileName}`.
- Sanitasi backup cloud dari credential lokal sebelum upload.
- Simpan manifest backup dengan `storeId`, schema version, dan device metadata
  yang aman untuk recovery.
- Restore harus membuat local snapshot, memvalidasi target store, dan menghapus
  atau menandai cursor sync agar tidak mendorong state lama secara keliru.
- Tambahkan monitoring orphan R2 object dan metadata yang gagal dihapus.

#### Exit criteria

- Dua upload concurrent tidak dapat melewati quota.
- Quota toko A tidak terpengaruh oleh backup toko B.
- Restore cross-store ditolak tanpa override eksplisit yang terdokumentasi.
- Backup lebih dari 30 hari benar-benar diproses pada seluruh halaman.
- Backup cloud tidak mengandung PIN hash atau session credential.

### Phase 5 - Frontend Cloud Hub dan UX

Prioritas: P1/P2 setelah backend aman.

#### Perubahan

- Ganti label tombol backup menjadi `Backup Sekarang`.
- Gunakan label `Sinkronkan Data` hanya untuk push/pull record.
- Tampilkan penjelasan bahwa backup adalah recovery, sedangkan sync adalah
  konvergensi data antar-device.
- Tampilkan status per toko: entitlement, expiry, last backup, last sync, pending,
  conflict, error, dan cursor batch.
- Jadikan status sync reactive melalui `useLiveQuery(syncMeta)` atau event state
  yang terpusat.
- Pisahkan pengaturan jadwal auto-backup dari status auto-sync.
- Jika keputusan produk tetap tanpa tombol manual, hapus tombol manual dan ubah
  `SYNC-QA.md`; jika tombol manual dipertahankan, revisi `DECISIONS.md`.
- Jangan tampilkan "background sync aktif" jika entitlement toko expired atau
  aplikasi hanya akan sync saat foreground.
- Profile API harus mengembalikan subscription per toko, bukan satu field agregat.
- Tampilkan device yang terhubung dan last seen setelah endpoint device list siap.

#### Exit criteria

- User dapat membedakan backup dan sync tanpa membaca dokumentasi tambahan.
- Semua status Cloud Hub sesuai toko yang sedang dipilih.
- Error sync menyebutkan batch, store, dan tindakan pemulihan yang aman.
- UI tidak menjanjikan background daemon ketika PWA sedang tertutup.

### Phase 6 - Test, observability, dan rollout

Prioritas: wajib sebelum production rollout.

#### Test yang harus ditambahkan

- Worker unit test untuk ownership, UUID, entitlement, field allowlist, payload size,
  LWW, cursor, acknowledgement, dan delete scope.
- Supabase SQL test untuk RLS, RPC grants, unique key, quota ledger, dan legacy claim.
- R2 integration test untuk upload, retry idempotent, quota race, retention, dan orphan.
- Fake IndexedDB test dengan full dataset:
  products, transactions, transactionItems, stock lots, allocations, stock opname,
  roles, customers, expenses, debts, dan tombstones.
- Two-device test dengan database kosong, database berisi default seed, dan database
  berisi data berbeda.
- Restore test antar toko dan credential exclusion test.
- Test concurrent `syncNow()` dari manual, online, visibility, dan interval.
- Test pull 5.001, 10.000, dan perubahan dengan timestamp sama.
- Test subscription expired, renewal per toko, dan legacy claim multi-store.

#### Observability

- Event `sync_push` dan `sync_pull` menyimpan store scope, batch size, duration,
  accepted count, rejected count, cursor, conflict count, dan error class.
- Dashboard menampilkan pending sync, cursor lag, conflict rate, quota rejection,
  restore failure, dan payment completed tanpa subscription.
- Alert jika satu store mengalami sync error berulang atau cursor tidak bergerak.

#### Rollout

1. Deploy migration dan Worker dengan `SYNC_ENABLED=false`.
2. Jalankan unit, SQL, R2, dan integration test.
3. Aktifkan hanya untuk internal tester.
4. Uji dua device nyata mengikuti seluruh skenario `SYNC-QA.md` yang telah direvisi.
5. Monitor minimal satu siklus operasional penuh sebelum rollout berikutnya.
6. Buka rollout bertahap berdasarkan error rate dan convergence metric.

## 9. Acceptance Criteria End-to-End

Fitur belum boleh disebut production-ready jika salah satu kondisi berikut masih
terjadi:

- Toko aktif masih dapat dihapus tanpa guard.
- Binding cloud store belum memperbarui registry dan `storeSettings` secara konsisten.
- Device B dapat menerima transaksi tanpa item atau allocation yang sesuai.
- Pull belum memiliki `nextCursor` dan pagination stabil.
- Payload masih membawa `pinHash` atau credential device.
- Initial sync belum meminta pilihan sumber data pada database non-empty.
- Restore belum memvalidasi `storeId` target.
- Quota masih memakai scan terbatas dan read-then-write tanpa lock.
- Rename frontend belum memiliki route Worker.
- Tidak ada test integration Worker + Supabase + R2.

Acceptance minimum pengguna:

1. Device A membuat produk dan transaksi lengkap.
2. Device B menerima produk, transaksi, item, stok, FIFO lot, dan allocation.
3. Device B offline melakukan transaksi.
4. Setelah online, queue terkirim dan device A menerima perubahan.
5. Edit simultan mengikuti aturan LWW yang terlihat oleh user.
6. Delete transaksi dan item tidak meninggalkan data aktif di device lain.
7. Toko A dan B dalam satu akun tetap terisolasi.
8. Backup toko A tidak muncul sebagai backup toko B.
9. Subscription toko A tidak mengaktifkan sync toko B.
10. POS tetap dapat berjualan ketika Worker atau internet tidak tersedia.

## 10. Prioritas Implementasi

| Urutan | Item | Alasan |
|---|---|---|
| 1 | Disable/limit sync dan block delete active store | Mencegah kerusakan baru |
| 2 | Perbaiki binding dan restore scope | Mencegah pencampuran antar toko |
| 3 | Keluarkan credential dan lengkapi child-table sync | Menutup risiko security dan data integrity |
| 4 | Perbaiki cursor, pagination, mutex, queue, dan acknowledgement | Menjamin convergence pada volume nyata |
| 5 | Perbaiki quota, retention, dan idempotency backup | Menjamin billing dan storage boundary |
| 6 | Selaraskan route Worker, profile per toko, dan UX | Menghilangkan false status dan broken action |
| 7 | Jalankan integration test dan rollout bertahap | Membuktikan sistem sebelum dibuka luas |

## 11. Referensi Source of Truth

- `docs/ARCHITECTURE.md`
- `docs/profitku-cloud.md`
- `docs/DECISIONS.md`
- `docs/SYNC-DESIGN.md`
- `docs/SYNC-QA.md`
- `docs/CLOUD-IMPLEMENTATION-PLAN.md`
- `docs/CLOUD-LEGACY-MIGRATION-MULTI-DEVICE-PLAN.md`
- `docs/MULTI-STORE.md`
- `src/pages/settings/CloudHub.tsx`
- `src/pages/settings/CloudStoreSettings.tsx`
- `src/lib/sync.ts`
- `src/lib/backup.ts`
- `workers/api/src/routes/helpers.ts`
- `workers/api/src/routes/sync.ts`
- `workers/api/src/routes/stores.ts`
- `workers/api/src/routes/backups.ts`
- `supabase/migrations/20260805120000_sync.sql`
- `supabase/migrations/20260808150000_per_store_subscription.sql`
- `supabase/migrations/20260811150000_sync_cursor_keyset.sql`
- `supabase/migrations/20260811160000_sync_server_time.sql`
- `supabase/migrations/20260811170000_backup_quota_reservation.sql`
- `supabase/migrations/20260811180000_sync_winner_ack.sql`

---

## 12. Status Implementasi (2026-08-11)

Status per temuan setelah sesi implementasi pertama. Verifikasi: `npm test`
22 file / 121 test lulus, `npm run lint` 0 error, typecheck app & Worker lulus.

| ID | Severity | Status | Catatan implementasi |
|---|---|---|---|
| CLOUD-001 | P0 | ✅ Selesai | Guard delete toko aktif + tombol hapus disembunyikan untuk toko terhubung |
| CLOUD-002 | P0 | ✅ Sebagian | Helper binding + safety gate database berisi data; initial-source wizard masih tertunda |
| CLOUD-003 | P0 | ✅ Sebagian | Hook sync + tombstone `transactionItems`/`stockOpnameItems`/`roles`; backfill Dexie v22; perubahan stok kini dirty (inventory/cashier-ops) |
| CLOUD-004 | P0 | ✅ Selesai | Pull keyset `server_updated_at|id` + `nextCursor`/`hasMore`; RPC memberi revision server monoton |
| CLOUD-005 | P0 | ✅ Sebagian | Credential di-strip; cloud restore mempertahankan user/device lokal; desain auth user antar-device masih tertunda |
| CLOUD-006 | P1 | ✅ Selesai | Dialog source selection, snapshot lokal, mode cloud/local, dan safety gate |
| CLOUD-007 | P1 | ✅ Selesai | Semua restore call site mengirim `storeId`; list backup mengembalikan scope toko |
| CLOUD-008 | P1 | ✅ Selesai | Validasi UUID/timestamp/size/allowlist + server revision + winner acknowledgement |
| CLOUD-009 | P1 | ✅ Selesai | Mutex, persistent `syncQueue`, retry backoff, acknowledgement guard, apply transaction |
| CLOUD-010 | P1 | ✅ Sebagian | Tombstone child table ditambah; mekanisme setTimeout dipertahankan (risiko terdokumentasi) |
| CLOUD-011 | P1 | ✅ Sebagian | Reservation RPC atomik + cleanup cron; integration race test production masih perlu |
| CLOUD-012 | P1 | ✅ Selesai | `PUT /api/stores/:id` (rename) ditambahkan di Worker |
| CLOUD-013 | P1 | ✅ Sebagian | Banner + pilihan claim legacy; data yang sudah salah auto-backfill masih perlu inventory/correction |
| CLOUD-014 | P2 | ✅ Sebagian | Label "Backup Sekarang"/"Sinkronkan Data" dipisah di 3 locale; keputusan tombol manual perlu revisi docs |
| CLOUD-015 | P2 | ✅ Selesai | Profile memilih subscription dengan expiry terpanjang (tidak ditimpa arbitrer) |

### Yang masih harus dikerjakan (sesi berikutnya)

- **CLOUD-011**: integration race test quota, orphan R2, dan reservation expiry pada environment Supabase/R2.
- **CLOUD-013**: inventory subscription legacy yang sudah terlanjur auto-backfill serta skrip correction terkontrol.
- Tombstone masih dibuat dengan fallback `setTimeout`; perlu pengujian crash/transaction hook khusus.
- LWW tetap menggunakan client timestamp untuk menentukan winner; server revision sudah aman untuk cursor.
- Test integration Worker + Supabase + R2 (Phase 6 audit) sebelum rollout.
- Validasi deployment order: migration `20260811150000`, `20260811160000`,
  `20260811170000`, dan `20260811180000` harus applied sebelum Worker/frontend
  baru digunakan production.
