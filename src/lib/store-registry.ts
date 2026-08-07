/**
 * Store Registry — dasar multi-toko (docs/MULTI-STORE.md M0).
 *
 * DB Dexie terpisah `kasirgratisan-stores` berisi daftar toko di perangkat ini.
 * Toko default (data existing) tetap memakai `kasirgratisan-db` — DB ini TIDAK
 * menyentuh data user. Toko tambahan memakai `kasirgratisan-db-<storeKey>`.
 */

import Dexie, { type Table } from 'dexie';

export type StoreMode = 'local' | 'cloud';

export interface LocalStoreEntry {
  id?: number;
  storeKey: string;             // uid unik -> penentu dbName
  name: string;
  icon?: string;                // emoji / warna
  mode: StoreMode;              // offline-only vs terhubung cloud
  cloudStoreId?: string | null; // cloud store (mode = 'cloud')
  dbName: string;               // 'kasirgratisan-db' (default) atau 'kasirgratisan-db-<storeKey>'
  storeType?: string;           // profil field produk (PRODUCT-TYPES)
  businessCategory?: string;    // kategori usaha (BUSINESS_CATEGORIES id)
  createdAt: Date;
  lastOpenedAt: Date | null;
}

class StoreRegistryDb extends Dexie {
  stores!: Table<LocalStoreEntry, number>;

  constructor() {
    super('kasirgratisan-stores');
    this.version(1).stores({
      stores: '++id, storeKey, mode, cloudStoreId, dbName, createdAt, lastOpenedAt',
    });
  }
}

export const storeRegistry = new StoreRegistryDb();

/** Kunci toko default — data existing di `kasirgratisan-db`. */
export const DEFAULT_STORE_KEY = 'default';

const ACTIVE_KEY_LS = 'profitku.activeStoreKey';

export function getActiveStoreKey(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY_LS) || DEFAULT_STORE_KEY;
  } catch {
    return DEFAULT_STORE_KEY;
  }
}

export function setActiveStoreKey(key: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY_LS, key);
  } catch {
    // ignore (private mode etc.)
  }
}

export function dbNameForStore(storeKey: string): string {
  return storeKey === DEFAULT_STORE_KEY ? 'kasirgratisan-db' : `kasirgratisan-db-${storeKey}`;
}

function newStoreKey(): string {
  try {
    return (crypto.randomUUID() ?? `s_${Date.now()}`).slice(0, 8);
  } catch {
    return `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

/**
 * Pastikan entry toko default ada (mengarah ke data existing).
 * Dipanggil saat startup; idempotent.
 */
export async function ensureDefaultStoreEntry(name?: string): Promise<LocalStoreEntry> {
  const existing = await storeRegistry.stores.where('storeKey').equals(DEFAULT_STORE_KEY).first();
  if (existing) return existing;
  const entry: LocalStoreEntry = {
    storeKey: DEFAULT_STORE_KEY,
    name: name?.trim() || 'Toko Saya',
    mode: 'local',
    cloudStoreId: null,
    dbName: dbNameForStore(DEFAULT_STORE_KEY),
    createdAt: new Date(),
    lastOpenedAt: null,
  };
  const id = await storeRegistry.stores.add(entry);
  return { ...entry, id };
}

export async function listStores(): Promise<LocalStoreEntry[]> {
  return storeRegistry.stores.orderBy('createdAt').toArray();
}

export async function addStore(input: {
  name: string;
  mode: StoreMode;
  cloudStoreId?: string | null;
  storeType?: string;
  businessCategory?: string;
}): Promise<LocalStoreEntry> {
  const storeKey = newStoreKey();
  const entry: LocalStoreEntry = {
    storeKey,
    name: input.name.trim(),
    mode: input.mode,
    cloudStoreId: input.cloudStoreId ?? null,
    dbName: dbNameForStore(storeKey),
    storeType: input.storeType,
    businessCategory: input.businessCategory,
    createdAt: new Date(),
    lastOpenedAt: null,
  };
  const id = await storeRegistry.stores.add(entry);
  return { ...entry, id };
}

export async function updateStore(storeKey: string, patch: Partial<LocalStoreEntry>): Promise<void> {
  await storeRegistry.stores.where('storeKey').equals(storeKey).modify(patch);
}

/**
 * Sinkronkan entry registry toko AKTIF dari storeSettings (nama/kategori/tipe).
 * Dipanggil setelah onboarding / edit nama toko / ubah kategori usaha, agar
 * dropdown toko di Beranda ikut ter-update (nama, emoji kategori, tipe produk).
 */
export async function syncStoreEntryFromSettings(settings: {
  storeName?: string;
  businessCategory?: string;
  storeType?: string;
}): Promise<void> {
  await ensureDefaultStoreEntry(settings.storeName);
  const patch: Partial<LocalStoreEntry> = {};
  if (settings.storeName?.trim()) patch.name = settings.storeName.trim();
  if (settings.businessCategory !== undefined) patch.businessCategory = settings.businessCategory;
  if (settings.storeType !== undefined) patch.storeType = settings.storeType;
  await updateStore(getActiveStoreKey(), patch);
}

export async function removeStore(storeKey: string): Promise<void> {
  await storeRegistry.stores.where('storeKey').equals(storeKey).delete();
  if (getActiveStoreKey() === storeKey) setActiveStoreKey(DEFAULT_STORE_KEY);
}
