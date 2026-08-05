# Profitku — Desain: Jenis Toko & Kolom Khusus Produk

> Draf desain untuk review. **Belum diimplementasikan.** Tujuan: saat pengaturan
> pertama, user memilih jenis toko → form produk otomatis menampilkan kolom
> pelengkap yang relevan (sepatu, kosmetik, dsb.), atau tanpa kolom khusus (umum).

## 1. Kebutuhan (dari keputusan produk)

| Jenis toko | Kolom khusus yang dibutuhkan |
|---|---|
| **Toko Sepatu** | size, insole, brand, SKU*, kategori (Basket, Boots, Formal, Running, Sneakers, dll), made in, baru/bekas; jika bekas → kondisi (Seperti baru, Sangat baik, Baik, Cukup) |
| **Toko Kosmetik** | Nomor BPOM (wajib), Nomor Halal (wajib), SKU*, tanggal kadaluarsa (wajib), dll |
| **Jenis toko lain** | Kolom khusus sebagai pelengkap (extensible / custom fields) |
| **Toko Umum** | Tanpa kolom khusus (produk seperti sekarang) |

\* SKU sudah ada sebagai kolom inti produk — tidak diulang di kolom khusus.

Pilihan jenis toko tampil **saat onboarding pertama kali** (setelah nama toko).

## 2. Pendekatan teknis

### 2.1 Model data

- Tambah `storeSettings.storeType: string` (mis. `'general' | 'shoes' | 'cosmetics' | 'other'`).
- Tambah kolom `attributes?: Record<string, unknown>` di `Product` (JSON) untuk
  menyimpan nilai kolom khusus.
- Definisi skema kolom khusus dipusatkan di `src/lib/product-fields.ts` (bukan
  hardcode di UI): tiap jenis toko → daftar field `{ key, label, type, required,
  options?, placeholder? }`.

```ts
// src/lib/product-fields.ts (ilustrasi)
export interface ProductFieldDef {
  key: string;
  labelKey: string;      // kunci i18n
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  required?: boolean;
  options?: string[];    // untuk select
  placeholderKey?: string;
}

export const PRODUCT_FIELDS: Record<string, ProductFieldDef[]> = {
  general: [],   // Toko Umum — tanpa kolom khusus
  shoes: [
    { key: 'brand',        labelKey: 'fields.shoes.brand', type: 'text', required: true },
    { key: 'size',         labelKey: 'fields.shoes.size', type: 'text', required: true },
    { key: 'insole',       labelKey: 'fields.shoes.insole', type: 'text' },
    { key: 'category',     labelKey: 'fields.shoes.category', type: 'select',
      options: ['Basket', 'Boots', 'Formal', 'Running', 'Sneakers', 'Sandal', 'Lainnya'], required: true },
    { key: 'madeIn',       labelKey: 'fields.shoes.madeIn', type: 'text' },
    { key: 'condition',    labelKey: 'fields.shoes.condition', type: 'select',
      options: ['new', 'used'], required: true },
    { key: 'conditionDetail', labelKey: 'fields.shoes.conditionDetail', type: 'select',
      options: ['seperti_baru', 'sangat_baik', 'baik', 'cukup'] }, // wajib jika condition=used
  ],
  cosmetics: [
    { key: 'bpomNumber',   labelKey: 'fields.cosmetics.bpomNumber', type: 'text', required: true },
    { key: 'halalNumber',  labelKey: 'fields.cosmetics.halalNumber', type: 'text', required: true },
    { key: 'expiryDate',   labelKey: 'fields.cosmetics.expiryDate', type: 'date', required: true },
  ],
};
```

### 2.2 Aturan tampil

- Form produk (tambah/edit) merender field dinamis dari `PRODUCT_FIELDS[storeType]`.
- Field `required` divalidasi sebelum simpan (toast error, sama pola existing).
- **Field kondisional:** `conditionDetail` hanya tampil/required jika
  `condition === 'used'` (didukung via properti `dependsOn` di def field).
- **Custom fields (jenis lain):** user bisa tambah kolom kustom sendiri
  (label + tipe + nilai) — disimpan juga di `attributes`; daftar definisinya di
  `storeSettings.customFields?: ProductFieldDef[]`.

### 2.3 Sinkronisasi & backup

- `attributes` ikut di-sync (bagian dari record produk) dan ikut backup JSON —
  tidak perlu perubahan protokol sync (kolom biasa).
- Saat restore backup: `storeType` dipulihkan; kolom yang tidak dikenal diabaikan
  (forward-compatible).

## 3. Alur onboarding

1. User isi nama/alamat/telepon toko (sudah ada).
2. **Step baru: pilih jenis toko** (cards: 👟 Sepatu, 💄 Kosmetik, 🏪 Umum, 🧩 Lainnya).
   - "Lainnya" → opsi buat kolom kustom nanti di Pengaturan.
3. Simpan `storeSettings.storeType`; produk-form menyesuaikan.

## 4. Pengaturan lanjutan

- Halaman Pengaturan → Toko: bisa **ubah jenis toko** (pilih ulang) + kelola
  custom fields (tambah/hapus kolom) untuk jenis "Lainnya".
- Mengubah jenis toko tidak menghapus `attributes` lama (hanya menyembunyikan kolom
  yang tidak relevan).

## 5. i18n

- Semua label/opsi via `src/i18n/locales/{id,en,ms}/` (namespace `productFields.*`)
  — ikuti aturan repo (no hardcode user-facing).

## 6. Risiko & catatan

| Risiko | Mitigasi |
|---|---|
| `attributes` bebas kunci → salah ketik | Gunakan definisi skema + validasi whitelist di form |
| Produk lama tanpa `attributes` | Selalu treat sebagai `{}` (optional) |
| Banyak jenis toko → duplikasi definisi | Satu file `product-fields.ts` + custom fields |
| Sinkronisasi nilai enum lintas bahasa | Simpan **nilai internal** (mis. `'used'`), label dari i18n |

## 7. Rencana implementasi

1. **M0:** `storeType` di storeSettings + `attributes` di Product + `product-fields.ts`.
2. **M1:** onboarding step jenis toko + form produk dinamis (render + validasi).
3. **M2:** custom fields (jenis "Lainnya") + Pengaturan kelola jenis/custom.
4. **M3:** i18n lengkap (id/en/ms) + test (validasi required/kondisional).
