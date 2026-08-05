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

export type StoreType = 'general' | 'shoes' | 'cosmetics' | 'other';

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
};

export const DEFAULT_STORE_TYPE: StoreType = 'general';

/** Semua jenis toko yang valid (termasuk 'other' yang field-nya user-defined). */
const VALID_STORE_TYPES: readonly StoreType[] = ['general', 'shoes', 'cosmetics', 'other'];

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
