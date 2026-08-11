# Profitku — Desain: Tambah Toko (Offline & Online)

> Baseline multi-store sudah diimplementasikan bertahap. Hardening dan rollout
> mengikuti [CLOUD-IMPLEMENTATION-PLAN.md](CLOUD-IMPLEMENTATION-PLAN.md). Tujuan: user dapat memiliki
> **lebih dari satu toko** dalam satu aplikasi — toko **offline** (data lokal saja)
> maupun **online** (terhubung cloud: backup + sync per toko). Melengkapi
> `SYNC-DESIGN.md`, `PRODUCT-TYPES.md`, dan `ROLES-PERMISSIONS.md`.

## 1. Kebutuhan (dari keputusan produk)

- User bisa **menambah toko** baru kapan saja (bukan hanya saat onboarding).
- **Toko offline:** berjalan penuh tanpa cloud (POS, stok, laporan, multi-user).
  Data tersimpan lokal, terpisah per toko.
- **Toko online:** terhubung cloud (backup + sync). Setiap toko online membutuhkan
  **1 langganan Rp 25.000/bulan** (`cloud_monthly` — per toko, bukan per device).
- **Ganti toko** cepat (store switcher); data toko **terisolasi** — produk, transaksi,
  laporan, pegawai tidak tercampur antar toko.

## 2. Prinsip desain

1. **Jangan menyentuh `kasirgratisan-db`** — toko pertama/default tetap di DB
   existing agar data user aman. Toko tambahan memakai DB Dexie terpisah.
2. **Isolasi total per toko** — tiap toko punya "dunia data" sendiri. Ini lebih aman
   daripada menambah kolom `storeId` ke semua tabel (migrasi rawan, sulit rollback).
3. **Offline dulu** — fitur multi-toko tidak boleh menghalangi jual-beli tanpa internet.
4. **Cloud per toko** — tiap toko online punya `cloudStoreId` + langganan sendiri.
5. **Jangan overpromise** — v1 = buat/pilih/ganti toko; agregasi lintas toko nanti.

## 3. Model data — Store Registry

Tabel registry kecil di DB terpisah **`kasirgratisan-stores`** (Dexie). Tidak
menyentuh `kasirgratisan-db`.

```ts
// DB: kasirgratisan-stores
interface LocalStoreEntry {
  id?: number;
  storeKey: string;             // uid unik (mis. 8 char UUID) -> penentu dbName
  name: string;
  icon?: string;                // emoji / warna
  mode: 'local' | 'cloud';      // offline-only vs terhubung cloud
  cloudStoreId?: string | null; // cloud store (mode = 'cloud')
  dbName: string;               // 'kasirgratisan-db' (toko default) atau 'kasirgratisan-db-<storeKey>'
  storeType?: string;           // dari PRODUCT-TYPES (per toko)
  createdAt: Date;
  lastOpenedAt: Date | null;
}

// activeStoreKey disimpan di registry (cache cepat di localStorage boleh)
```

- **Toko pertama (existing):** entry dibuat saat migrasi/upgrade — `dbName:
  'kasirgratisan-db'`, `mode` ditentukan saat bind cloud.
- **Tambah toko offline:** entry baru + DB `kasirgratisan-db-<storeKey>` (dibuat
  kosong via Dexie version 1) → onboarding singkat (nama toko, jenis toko).
- **Tambah toko online:** entry baru + checkout langganan `cloud_monthly` untuk toko
  itu → bind `cloudStoreId` (endpoint `/api/stores` sudah ada) → backup/sync jalan
  per toko.

## 4. Arsitektur runtime — DB per toko

- `src/lib/db.ts` saat ini instance tunggal `kasirgratisan-db`. Diubah menjadi
  **factory** `getDb(storeKey): PosDatabase` + **store context**
  (`StoreProvider` / `useActiveStore()`).
- Store context dibawa React context + disimpan di registry. Helper & hook membaca
  `useActiveStore()` untuk memilih DB.
- **Upgrade bertahap:** v1 factory hanya untuk switching; helper lama yang memakai
  instance tunggal dimigrasikan per halaman/file bertahap — tidak sekali rombak.
- Setiap DB tetap memakai `PosDatabase` yang sama (15 schema version sudah ada).

## 5. Alur user

1. **Home / Login:** store switcher (ikon + nama toko + badge mode `lokal`/`cloud`).
2. **Tambah toko** (Settings → Toko → "+ Tambah Toko"), wizard 2 langkah:
   - Pilih **Offline** atau **Online**.
   - Nama toko (+ pilih **jenis toko** dari `PRODUCT-TYPES.md`).
   - Jika **Online:** pilih langganan `cloud_monthly` (Rp 25rb/toko) → checkout
     (Midtrans/mock) → bind cloud store → selesai.
3. **Buka toko:** load DB toko tsb, set active, seluruh halaman memakai data toko itu.

## 6. Sinkronisasi & backup per toko

- **Scope sync = satu toko** (sudah dirancang di `SYNC-DESIGN.md` — push/pull per
  `storeId`). Multi-toko = jalankan pipeline per toko online saat online.
- **Backup cloud:** `uploadBackup(json, fileName, storeId)` sudah butuh `storeId`
  saat sync aktif — setiap toko online memakai `cloudStoreId` sendiri; retensi 30
  hari per toko.
- **Backup manual/JSON:** per toko (dari halaman toko tsb), nama file diberi
  penanda toko.
- **Restore:** hanya ke toko yang sama (`cloudStoreId`/`storeKey`); `cloudStoreId`
  di-null-kan setelah restore (konsisten dengan `ARCHITECTURE.md`).

## 7. Monetisasi & entitlement

- **Tidak ada batas jumlah toko cloud total**. Setiap toko online membutuhkan satu
  langganan `cloud_monthly` (Rp 25rb/bulan, kuota 1024 MB).
- Toko offline tetap gratis dan tidak memakai quota cloud.
- UI CloudHub: daftar langganan per toko + status aktif/expired; pesan jujur
  "1 langganan = 1 toko".

## 8. Interaksi dengan desain lain

| Desain | Hubungan |
|---|---|
| `PRODUCT-TYPES.md` | `storeType` & custom fields **per toko** (tiap toko punya jenis sendiri) |
| `ROLES-PERMISSIONS.md` | user & role **per toko** (tiap toko punya daftar pegawai sendiri) |
| `SYNC-DESIGN.md` | sync per `storeId`; multi-toko = pilih toko, pipeline berjalan per toko |
| Backup cloud | per `cloudStoreId` (API sudah mendukung) |

## 9. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Refactor instance tunggal → factory berisiko | Bertahap per file; `getDb` fallback default; tsc per langkah |
| Banyak DB terbuka → resource besar | Buka satu DB aktif saja; tutup DB saat ganti toko |
| Data existing hilang saat migrasi registry | Toko pertama tetap `kasirgratisan-db`; registry terpisah; rollback aman |
| Sync/backup salah toko | `storeId` wajib di semua request; guard server-side |
| Multi-user/roles tercampur antar toko | Tabel users/roles per DB toko |

## 10. Rencana implementasi

1. **M0 — Registry:** DB `kasirgratisan-stores` + `LocalStoreEntry` + migrasi
   (entry default untuk data existing) + `getDb(storeKey)` + store context.
2. **M1 — Switching:** store switcher (Home/Settings); ganti toko (buka/tutup DB);
   onboarding singkat toko baru (nama + jenis toko).
3. **M2 — Tambah toko offline:** wizard "Tambah Toko" → offline (buat DB + onboarding).
4. **M3 — Tambah toko online:** wizard → online (checkout `cloud_monthly` → bind
   `cloudStoreId` → backup/sync per toko) + UI status langganan per toko.
5. **M4 — Migrasi helper per halaman** ke factory + test (isolasi data, switch,
   restore per toko) + i18n lengkap.

## 11. Batas v1 (tidak dilakukan)

- Multi-toko dalam **satu** DB (kolom `storeId` di semua tabel) — ditolak: migrasi
  besar + risiko data hilang.
- Dashboard agregat / gabungan data antar toko — fase lanjutan.
- Transfer / duplikasi data antar toko — fase lanjutan.
