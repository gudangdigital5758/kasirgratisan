/**
 * Skema kolom khusus produk berdasarkan jenis toko (docs/PRODUCT-TYPES.md).
 * Single source of truth untuk definisi field — UI (form produk, onboarding,
 * settings) memakai file ini, bukan hardcode.
 *
 * Nilai disimpan di `Product.attributes` (JSON). Nilai internal (mis. 'used')
 * disimpan apa adanya; label ditampilkan lewat i18n (labelKey) atau literal
 * (label, untuk custom fields buatan user).
 */

export type ProductFieldType = 'text' | 'number' | 'select' | 'date' | 'boolean';

export type StoreType =
  | 'general'
  | 'shoes'
  | 'cosmetics'
  | 'fashion'
  | 'food'
  | 'fresh'
  | 'electronics'
  | 'automotive'
  | 'service'
  | 'pet'
  | 'furniture'
  | 'other';

export interface ProductFieldOption {
  value: string;
  /** Kunci i18n (namespace productFields). Jika kosong, tampilkan `value`. */
  labelKey?: string;
}

export interface ProductFieldDef {
  key: string;
  /** Kunci i18n (namespace productFields) — dipakai oleh field bawaan. */
  labelKey?: string;
  /** Label literal — dipakai oleh custom fields buatan user. */
  label?: string;
  type: ProductFieldType;
  required?: boolean;
  options?: ProductFieldOption[];
  /** Field hanya tampil/required saat atribut `key` bernilai `value`. */
  dependsOn?: { key: string; value: string };
  placeholderKey?: string;
}

export interface StoreTypeDef {
  value: StoreType;
  icon: string;
  labelKey: string;
  descKey: string;
}

export const STORE_TYPES: StoreTypeDef[] = [
  {
    value: 'general',
    icon: '🏪',
    labelKey: 'productFields:types.general.name',
    descKey: 'productFields:types.general.desc',
  },
  {
    value: 'shoes',
    icon: '👟',
    labelKey: 'productFields:types.shoes.name',
    descKey: 'productFields:types.shoes.desc',
  },
  {
    value: 'cosmetics',
    icon: '💄',
    labelKey: 'productFields:types.cosmetics.name',
    descKey: 'productFields:types.cosmetics.desc',
  },
  {
    value: 'fashion',
    icon: '👗',
    labelKey: 'productFields:types.fashion.name',
    descKey: 'productFields:types.fashion.desc',
  },
  {
    value: 'food',
    icon: '🍽️',
    labelKey: 'productFields:types.food.name',
    descKey: 'productFields:types.food.desc',
  },
  {
    value: 'fresh',
    icon: '🥬',
    labelKey: 'productFields:types.fresh.name',
    descKey: 'productFields:types.fresh.desc',
  },
  {
    value: 'electronics',
    icon: '📱',
    labelKey: 'productFields:types.electronics.name',
    descKey: 'productFields:types.electronics.desc',
  },
  {
    value: 'automotive',
    icon: '🚗',
    labelKey: 'productFields:types.automotive.name',
    descKey: 'productFields:types.automotive.desc',
  },
  {
    value: 'service',
    icon: '🛎️',
    labelKey: 'productFields:types.service.name',
    descKey: 'productFields:types.service.desc',
  },
  {
    value: 'pet',
    icon: '🐾',
    labelKey: 'productFields:types.pet.name',
    descKey: 'productFields:types.pet.desc',
  },
  {
    value: 'furniture',
    icon: '🛋️',
    labelKey: 'productFields:types.furniture.name',
    descKey: 'productFields:types.furniture.desc',
  },
  {
    value: 'other',
    icon: '🧩',
    labelKey: 'productFields:types.other.name',
    descKey: 'productFields:types.other.desc',
  },
];

export const PRODUCT_FIELDS: Record<string, ProductFieldDef[]> = {
  // Toko Umum — tanpa kolom khusus
  general: [],

  shoes: [
    { key: 'brand', labelKey: 'productFields:fields.shoes.brand', type: 'text', required: true },
    { key: 'size', labelKey: 'productFields:fields.shoes.size', type: 'text', required: true },
    { key: 'insole', labelKey: 'productFields:fields.shoes.insole', type: 'text' },
    {
      key: 'category',
      labelKey: 'productFields:fields.shoes.category',
      type: 'select',
      required: true,
      options: [
        { value: 'Basket', labelKey: 'productFields:options.shoes.category.Basket' },
        { value: 'Boots', labelKey: 'productFields:options.shoes.category.Boots' },
        { value: 'Formal', labelKey: 'productFields:options.shoes.category.Formal' },
        { value: 'Running', labelKey: 'productFields:options.shoes.category.Running' },
        { value: 'Sneakers', labelKey: 'productFields:options.shoes.category.Sneakers' },
        { value: 'Sandal', labelKey: 'productFields:options.shoes.category.Sandal' },
        { value: 'Lainnya', labelKey: 'productFields:options.shoes.category.Lainnya' },
      ],
    },
    { key: 'madeIn', labelKey: 'productFields:fields.shoes.madeIn', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.shoes.condition',
      type: 'select',
      required: true,
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
    {
      key: 'conditionDetail',
      labelKey: 'productFields:fields.shoes.conditionDetail',
      type: 'select',
      required: true,
      dependsOn: { key: 'condition', value: 'used' },
      options: [
        { value: 'seperti_baru', labelKey: 'productFields:options.shoes.conditionDetail.seperti_baru' },
        { value: 'sangat_baik', labelKey: 'productFields:options.shoes.conditionDetail.sangat_baik' },
        { value: 'baik', labelKey: 'productFields:options.shoes.conditionDetail.baik' },
        { value: 'cukup', labelKey: 'productFields:options.shoes.conditionDetail.cukup' },
      ],
    },
  ],

  cosmetics: [
    { key: 'bpomNumber', labelKey: 'productFields:fields.cosmetics.bpomNumber', type: 'text', required: true },
    { key: 'halalNumber', labelKey: 'productFields:fields.cosmetics.halalNumber', type: 'text', required: true },
    { key: 'expiryDate', labelKey: 'productFields:fields.cosmetics.expiryDate', type: 'date', required: true },
  ],

  fashion: [
    { key: 'size', labelKey: 'productFields:fields.fashion.size', type: 'text' },
    { key: 'material', labelKey: 'productFields:fields.fashion.material', type: 'text' },
    { key: 'brand', labelKey: 'productFields:fields.fashion.brand', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.fashion.condition',
      type: 'select',
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
  ],

  food: [
    { key: 'expiryDate', labelKey: 'productFields:fields.food.expiryDate', type: 'date', required: true },
    { key: 'halalNumber', labelKey: 'productFields:fields.food.halalNumber', type: 'text' },
    { key: 'weight', labelKey: 'productFields:fields.food.weight', type: 'text' },
    { key: 'productionDate', labelKey: 'productFields:fields.food.productionDate', type: 'date' },
  ],

  fresh: [
    { key: 'weight', labelKey: 'productFields:fields.fresh.weight', type: 'text', required: true },
    { key: 'origin', labelKey: 'productFields:fields.fresh.origin', type: 'text' },
    { key: 'harvestDate', labelKey: 'productFields:fields.fresh.harvestDate', type: 'date' },
    { key: 'expiryDate', labelKey: 'productFields:fields.fresh.expiryDate', type: 'date' },
  ],

  electronics: [
    { key: 'brand', labelKey: 'productFields:fields.electronics.brand', type: 'text', required: true },
    { key: 'model', labelKey: 'productFields:fields.electronics.model', type: 'text' },
    { key: 'warranty', labelKey: 'productFields:fields.electronics.warranty', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.electronics.condition',
      type: 'select',
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
  ],

  automotive: [
    { key: 'brand', labelKey: 'productFields:fields.automotive.brand', type: 'text' },
    { key: 'partNo', labelKey: 'productFields:fields.automotive.partNo', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.automotive.condition',
      type: 'select',
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
    { key: 'compatibility', labelKey: 'productFields:fields.automotive.compatibility', type: 'text' },
  ],

  service: [
    { key: 'duration', labelKey: 'productFields:fields.service.duration', type: 'text' },
    { key: 'byAppointment', labelKey: 'productFields:fields.service.byAppointment', type: 'boolean' },
  ],

  pet: [
    { key: 'species', labelKey: 'productFields:fields.pet.species', type: 'text', required: true },
    { key: 'breed', labelKey: 'productFields:fields.pet.breed', type: 'text' },
    { key: 'age', labelKey: 'productFields:fields.pet.age', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.pet.condition',
      type: 'select',
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
  ],

  furniture: [
    { key: 'material', labelKey: 'productFields:fields.furniture.material', type: 'text' },
    { key: 'dimension', labelKey: 'productFields:fields.furniture.dimension', type: 'text' },
    {
      key: 'condition',
      labelKey: 'productFields:fields.furniture.condition',
      type: 'select',
      options: [
        { value: 'new', labelKey: 'productFields:options.shoes.condition.new' },
        { value: 'used', labelKey: 'productFields:options.shoes.condition.used' },
      ],
    },
  ],
};

export const DEFAULT_STORE_TYPE: StoreType = 'general';

/** Semua jenis toko yang valid (termasuk 'other' yang field-nya user-defined). */
const VALID_STORE_TYPES: readonly StoreType[] = [
  'general',
  'shoes',
  'cosmetics',
  'fashion',
  'food',
  'fresh',
  'electronics',
  'automotive',
  'service',
  'pet',
  'furniture',
  'other',
];

/** Normalisasi nilai storeType dari penyimpanan (bisa undefined/kosong). */
export function normalizeStoreType(value: string | null | undefined): StoreType {
  return VALID_STORE_TYPES.includes(value as StoreType) ? (value as StoreType) : DEFAULT_STORE_TYPE;
}

/** Field bawaan + custom fields (jenis "Lainnya"). */
export function getProductFields(
  storeType: string | null | undefined,
  customFields?: { key: string; label: string; type: ProductFieldType; required?: boolean; options?: string[] }[],
): ProductFieldDef[] {
  const builtin = PRODUCT_FIELDS[normalizeStoreType(storeType)] ?? [];
  const customs: ProductFieldDef[] = (customFields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options?.map((o) => ({ value: o })),
  }));
  return [...builtin, ...customs];
}

/** Field yang sedang tampil (memenuhi dependsOn). */
export function getVisibleFields(
  storeType: string | null | undefined,
  attributes: Record<string, unknown>,
  customFields?: { key: string; label: string; type: ProductFieldType; required?: boolean; options?: string[] }[],
): ProductFieldDef[] {
  return getProductFields(storeType, customFields).filter((f) => {
    if (!f.dependsOn) return true;
    return attributes[f.dependsOn.key] === f.dependsOn.value;
  });
}

/** Field wajib yang sedang tampil dan belum terisi. */
export function getMissingRequiredFields(
  storeType: string | null | undefined,
  attributes: Record<string, unknown>,
  customFields?: { key: string; label: string; type: ProductFieldType; required?: boolean; options?: string[] }[],
): ProductFieldDef[] {
  return getVisibleFields(storeType, attributes, customFields).filter((f) => {
    if (!f.required) return false;
    const v = attributes[f.key];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

/** Buang nilai kosong agar `attributes` ringkas & konsisten. */
export function cleanAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

/** Nilai-nilai atribut yang tampil untuk kartu produk (key non-internal). */
export function getDisplayAttributes(
  storeType: string | null | undefined,
  attributes: Record<string, unknown> | undefined,
  customFields?: { key: string; label: string; type: ProductFieldType; required?: boolean; options?: string[] }[],
): { field: ProductFieldDef; value: unknown }[] {
  if (!attributes) return [];
  const fields = getVisibleFields(storeType, attributes, customFields);
  return fields
    .filter((f) => {
      const v = attributes[f.key];
      return v !== undefined && v !== null && v !== '';
    })
    .map((f) => ({ field: f, value: attributes[f.key] }));
}

// =====================================================================
// Kategori Usaha (BUSINESS_CATEGORIES)
// Daftar kategori usaha seperti aplikasi kasir kompetitor — dipilih saat
// membuat toko. Setiap kategori memetakan ke satu profil field produk
// (StoreType) agar form produk otomatis menampilkan kolom yang relevan.
// =====================================================================

export interface BusinessCategory {
  id: string;
  icon: string;
  /** Kunci i18n (namespace productFields, key cats.<id>) */
  labelKey: string;
  /** Profil field produk yang dipakai kategori ini. */
  profile: StoreType;
}

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { id: 'sembako', icon: '🛒', labelKey: 'productFields:cats.sembako', profile: 'general' },
  { id: 'kelontong', icon: '🏪', labelKey: 'productFields:cats.kelontong', profile: 'general' },
  { id: 'makanan_minuman', icon: '🍜', labelKey: 'productFields:cats.makanan_minuman', profile: 'food' },
  { id: 'restoran_kafe', icon: '☕', labelKey: 'productFields:cats.restoran_kafe', profile: 'food' },
  { id: 'katering', icon: '🍱', labelKey: 'productFields:cats.katering', profile: 'food' },
  { id: 'kuliner_kaki_lima', icon: '🌭', labelKey: 'productFields:cats.kuliner_kaki_lima', profile: 'food' },
  { id: 'toko_roti', icon: '🍞', labelKey: 'productFields:cats.toko_roti', profile: 'food' },
  { id: 'toko_manisan', icon: '🍬', labelKey: 'productFields:cats.toko_manisan', profile: 'food' },
  { id: 'produk_susu', icon: '🥛', labelKey: 'productFields:cats.produk_susu', profile: 'food' },
  { id: 'buah_sayuran', icon: '🥬', labelKey: 'productFields:cats.buah_sayuran', profile: 'fresh' },
  { id: 'perikanan', icon: '🐟', labelKey: 'productFields:cats.perikanan', profile: 'fresh' },
  { id: 'pertanian', icon: '🌾', labelKey: 'productFields:cats.pertanian', profile: 'fresh' },
  { id: 'unggas', icon: '🐔', labelKey: 'productFields:cats.unggas', profile: 'fresh' },
  { id: 'pembibitan', icon: '🌱', labelKey: 'productFields:cats.pembibitan', profile: 'fresh' },
  { id: 'rumah_segar', icon: '❄️', labelKey: 'productFields:cats.rumah_segar', profile: 'fresh' },
  { id: 'kosmetik', icon: '💄', labelKey: 'productFields:cats.kosmetik', profile: 'cosmetics' },
  { id: 'salon_kecantikan', icon: '💇', labelKey: 'productFields:cats.salon_kecantikan', profile: 'service' },
  { id: 'pakaian', icon: '👕', labelKey: 'productFields:cats.pakaian', profile: 'fashion' },
  { id: 'aksesoris_fashion', icon: '👜', labelKey: 'productFields:cats.aksesoris_fashion', profile: 'fashion' },
  { id: 'perhiasan', icon: '💍', labelKey: 'productFields:cats.perhiasan', profile: 'fashion' },
  { id: 'tekstil', icon: '🧵', labelKey: 'productFields:cats.tekstil', profile: 'fashion' },
  { id: 'penjahitan', icon: '🪡', labelKey: 'productFields:cats.penjahitan', profile: 'fashion' },
  { id: 'alas_kaki', icon: '👟', labelKey: 'productFields:cats.alas_kaki', profile: 'shoes' },
  { id: 'elektronik', icon: '📺', labelKey: 'productFields:cats.elektronik', profile: 'electronics' },
  { id: 'ponsel_aksesoris', icon: '📱', labelKey: 'productFields:cats.ponsel_aksesoris', profile: 'electronics' },
  { id: 'layanan_komputer', icon: '🖥️', labelKey: 'productFields:cats.layanan_komputer', profile: 'electronics' },
  { id: 'teknologi_informasi', icon: '💻', labelKey: 'productFields:cats.teknologi_informasi', profile: 'electronics' },
  { id: 'otomotif_suku_cadang', icon: '🚗', labelKey: 'productFields:cats.otomotif_suku_cadang', profile: 'automotive' },
  { id: 'bengkel', icon: '🔧', labelKey: 'productFields:cats.bengkel', profile: 'automotive' },
  { id: 'perkakas', icon: '🛠️', labelKey: 'productFields:cats.perkakas', profile: 'automotive' },
  { id: 'perabotan', icon: '🛋️', labelKey: 'productFields:cats.perabotan', profile: 'furniture' },
  { id: 'peralatan_dapur', icon: '🍳', labelKey: 'productFields:cats.peralatan_dapur', profile: 'furniture' },
  { id: 'toko_hewan_peliharaan', icon: '🐾', labelKey: 'productFields:cats.toko_hewan_peliharaan', profile: 'pet' },
  { id: 'laundry', icon: '🧺', labelKey: 'productFields:cats.laundry', profile: 'service' },
  { id: 'studio_foto', icon: '📷', labelKey: 'productFields:cats.studio_foto', profile: 'service' },
  { id: 'layanan_hukum', icon: '⚖️', labelKey: 'productFields:cats.layanan_hukum', profile: 'service' },
  { id: 'layanan_pemeliharaan', icon: '🧰', labelKey: 'productFields:cats.layanan_pemeliharaan', profile: 'service' },
  { id: 'konsultasi', icon: '🤝', labelKey: 'productFields:cats.konsultasi', profile: 'service' },
  { id: 'pendidikan', icon: '🎓', labelKey: 'productFields:cats.pendidikan', profile: 'service' },
  { id: 'medis_kesehatan', icon: '🏥', labelKey: 'productFields:cats.medis_kesehatan', profile: 'service' },
  { id: 'dokter_hewan', icon: '🩺', labelKey: 'productFields:cats.dokter_hewan', profile: 'service' },
  { id: 'olahraga_kebugaran', icon: '🏋️', labelKey: 'productFields:cats.olahraga_kebugaran', profile: 'service' },
  { id: 'layanan_keuangan', icon: '💰', labelKey: 'productFields:cats.layanan_keuangan', profile: 'service' },
  { id: 'tur_perjalanan', icon: '✈️', labelKey: 'productFields:cats.tur_perjalanan', profile: 'service' },
  { id: 'transportasi', icon: '🚚', labelKey: 'productFields:cats.transportasi', profile: 'service' },
  { id: 'hotel', icon: '🏨', labelKey: 'productFields:cats.hotel', profile: 'service' },
  { id: 'percetakan', icon: '🖨️', labelKey: 'productFields:cats.percetakan', profile: 'service' },
  { id: 'hadiah_mainan', icon: '🎁', labelKey: 'productFields:cats.hadiah_mainan', profile: 'general' },
  { id: 'kerajinan_tangan', icon: '🧶', labelKey: 'productFields:cats.kerajinan_tangan', profile: 'general' },
  { id: 'alat_tulis', icon: '✏️', labelKey: 'productFields:cats.alat_tulis', profile: 'general' },
  { id: 'bahan_bakar', icon: '⛽', labelKey: 'productFields:cats.bahan_bakar', profile: 'general' },
  { id: 'air_galon', icon: '💧', labelKey: 'productFields:cats.air_galon', profile: 'general' },
  { id: 'toko_keagamaan', icon: '🕌', labelKey: 'productFields:cats.toko_keagamaan', profile: 'general' },
  { id: 'musik', icon: '🎵', labelKey: 'productFields:cats.musik', profile: 'general' },
  { id: 'hiburan', icon: '🎮', labelKey: 'productFields:cats.hiburan', profile: 'general' },
  { id: 'pabrik', icon: '🏭', labelKey: 'productFields:cats.pabrik', profile: 'general' },
  { id: 'nirlaba', icon: '🤲', labelKey: 'productFields:cats.nirlaba', profile: 'general' },
  { id: 'toko_online', icon: '🛍️', labelKey: 'productFields:cats.toko_online', profile: 'general' },
  { id: 'konstruksi', icon: '🏗️', labelKey: 'productFields:cats.konstruksi', profile: 'service' },
  { id: 'layanan_keamanan', icon: '🛡️', labelKey: 'productFields:cats.layanan_keamanan', profile: 'service' },
  { id: 'pengumpulan_sampah', icon: '♻️', labelKey: 'productFields:cats.pengumpulan_sampah', profile: 'service' },
  { id: 'operator_kabel', icon: '📡', labelKey: 'productFields:cats.operator_kabel', profile: 'service' },
  { id: 'lainnya', icon: '🧩', labelKey: 'productFields:cats.lainnya', profile: 'other' },
];

/** Cari kategori usaha by id. */
export function findBusinessCategory(id: string | null | undefined): BusinessCategory | undefined {
  return BUSINESS_CATEGORIES.find((c) => c.id === id);
}

/** Profil field produk dari sebuah kategori usaha. */
export function profileForCategory(id: string | null | undefined): StoreType {
  return findBusinessCategory(id)?.profile ?? DEFAULT_STORE_TYPE;
}

/**
 * Resolusi storeType dari pilihan kategori + nilai legacy (storeType lama).
 * Kategori baru menang; fallback ke normalizeStoreType (nilai lama).
 */
export function resolveStoreType(
  businessCategory: string | null | undefined,
  storeType: string | null | undefined,
): StoreType {
  if (businessCategory) {
    const p = profileForCategory(businessCategory);
    if (p !== 'general' || findBusinessCategory(businessCategory)) return p;
  }
  return normalizeStoreType(storeType);
}
