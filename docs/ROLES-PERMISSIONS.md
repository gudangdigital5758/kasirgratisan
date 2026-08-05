# Profitku — Desain: Role Administrator & Kustomisasi Menu per Role

> Draf desain untuk review. **Belum diimplementasikan.** Tujuan: ada **role
> Administrator** yang bisa mengatur menu **on/off** untuk role **Admin**, **Sales**,
> dan role pegawai lain (termasuk role kustom).

## 1. Kebutuhan (dari keputusan produk)

- **Role Administrator** — setara pemilik, bisa mengelola user & **mengatur hak
  akses (menu on/off) untuk setiap role**.
- Role bawaan selain Administrator: **Admin**, **Sales**, dan role pegawai lain.
- Administrator boleh membuat **role kustom** (nama + set hak akses sendiri).
- "Menu on/off" = menu disembunyikan/ditampilkan sesuai hak akses role.

## 2. Kondisi eksisting (fondasi)

- Sudah ada `PermissionKey` (12 kunci), `ALL_PERMISSIONS`, `hasPermission(user, key)`,
  `can()` di `useAuth`, `DEFAULT_STAFF_PERMISSIONS`, gate UI per menu.
- `User.role: 'owner' | 'staff'` + `user.permissions: PermissionKey[]`.
- `canManageUsers(user)` = owner-only.

→ Perluasan: role bernama + kustom + manajer role di UI (tidak menulis ulang gate).

## 3. Model data (Dexie)

### 3.1 Tabel baru `roles`

```ts
interface Role {
  id?: number;
  name: string;                 // "Admin", "Sales", "Karyawan Toko", dll
  permissions: PermissionKey[]; // set hak akses
  isBuiltIn: number;            // 1 = bawaan (Admin/Sales), 0 = kustom
  isActive: number;
  createdAt: Date;
  updatedAt?: Date;
  syncedAt?: Date | null;       // ikut sync cloud nanti
}
```

- **Administrator** = `role: 'owner'` (implicit full + bisa kelola roles/users).
  Tidak butuh baris di `roles` (atau boleh sebagai built-in khusus).
- **Role bawaan v1:** `Admin` (permission lengkap minus kelola roles), `Sales`
  (`create_transaction` + `delete_transaction`? — default seperti staff sekarang).
- **Role kustom:** dibuat Administrator (nama + toggle permission).

### 3.2 User

- `User.role` diperluas menjadi `'owner' | 'staff' | number` (id role) — atau
  tambah `roleId?: number` sambil `role` tetap untuk backward-compat.
  **Pilihan desain:** tambah `roleId` (referensi `roles.id`); `role: 'staff'` lama
  dipetakan ke role default "Karyawan" saat migrasi.
- `user.permissions` tetap dipakai untuk role staff/kustom; **owner/Administrator
  implicit all**.

## 4. Pemetaan Menu ↔ Permission (terpusat)

```ts
// src/lib/menu-permissions.ts (ilustrasi)
export const MENU_PERMISSION: Record<string, PermissionKey | 'owner'> = {
  '/cashier': 'create_transaction',
  '/products': 'manage_products',
  '/reports': 'view_reports',
  '/history': 'delete_transaction', // lihat riwayat butuh minimal akses transaksi
  '/stock-in': 'manage_stock_inout',
  '/stock-out': 'manage_stock_inout',
  '/stock-report': 'view_reports',
  '/supplier': 'manage_supplier',
  '/customers': 'manage_customers',
  '/debts': 'manage_customers',
  '/expenses': 'view_expenses',
  '/shifts': 'create_transaction',
  '/settings/...': 'manage_store_settings',
};
```

- `can()` + `MENU_PERMISSION` dipakai oleh `AppLayout`/`NavLink` untuk **menyembunyikan
  menu** (bottom nav / settings card) saat permission off — persis gate yang sudah
  ada, tapi kini menu mapping terpusat sehingga "on/off menu" = toggle permission.

## 5. UI Pengaturan → "Karyawan & Hak Akses"

1. **Daftar role** (Administrator, Admin, Sales, + kustom).
2. Pilih role → layar **toggle permission** dikelompokkan per menu:
   - Kasir & Transaksi
   - Produk & Stok
   - Laporan
   - Pelanggan/Hutang/Supplier
   - Pengeluaran
   - Backup & Pengaturan
   - **Kelola Role/User** (hanya Administrator)
3. Simpan → `roles` diupdate; user dengan role tsb langsung terpengaruh
   (re-render via `useAuth`/`useLiveQuery`).
4. **Kelola user:** pilih role saat buat/edit pegawai (dropdown role) — ganti input
   permission per-user saat ini menjadi berbasis role (tetap boleh override per-user
   jika dibutuhkan).

## 6. Alur & keamanan

- Hanya **Administrator** (`canManageUsers`) yang bisa: membuat/mengedit/menghapus
  role, dan mengubah role user.
- Perubahan permission hanya gate UI (client). Karena multi-user lokal bersifat
  device-local (bukan security server-grade — sudah didokumentasikan di DECISIONS),
  gate ini cukup untuk mencegah karyawan mengakses menu yang tidak diizinkan di UI.
- **Menu yang disembunyikan tidak menampilkan datanya** (gate di halaman via
  `LockedPage`, sudah ada).

## 7. Migrasi

- Upgrade Dexie: buat tabel `roles` + seed role bawaan (Admin, Sales) + pemetaan
  `user.role === 'staff'` → `roleId` default "Karyawan" dengan `permissions`
  yang sudah ada (tetap dipertahankan).
- Tidak menghapus `permissions` lama agar rollback aman.

## 8. i18n & test

- Label role & grup menu via `src/i18n/locales/{id,en,ms}/`.
- Unit test: `hasPermission` untuk role owner/staff/kustom; mapping menu; migrasi
  role default.

## 9. Rencana implementasi

1. **M0:** `roles` tabel + migrasi + seed bawaan + `roleId` di user.
2. **M1:** `menu-permissions.ts` + `AppLayout`/nav menggunakan mapping (menu on/off).
3. **M2:** UI manajer role (list + toggle per menu) + pilih role saat edit user.
4. **M3:** i18n lengkap + test + smoke manual (buat role, matikan menu, verifikasi
   menu hilang untuk user role tsb).
