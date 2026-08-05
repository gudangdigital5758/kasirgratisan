/**
 * Hook toko aktif (MULTI-STORE M0). Membaca registry tanpa perlu provider —
 * cukup untuk tahap awal (belum ada UI switch toko, aktif selalu toko default).
 */

import { useLiveQuery } from 'dexie-react-hooks';
import {
  storeRegistry,
  getActiveStoreKey,
  setActiveStoreKey,
  DEFAULT_STORE_KEY,
  type LocalStoreEntry,
} from '@/lib/store-registry';

export function useActiveStore() {
  const stores = useLiveQuery(() => storeRegistry.stores.toArray());
  const activeKey = getActiveStoreKey();
  const activeStore =
    stores?.find((s) => s.storeKey === activeKey) ??
    stores?.find((s) => s.storeKey === DEFAULT_STORE_KEY);

  return {
    /** Daftar toko di perangkat ini (urut createdAt). */
    stores: stores ?? [] as LocalStoreEntry[],
    /** Toko yang sedang aktif (fallback: toko default). */
    activeStore,
    /** Pindah toko aktif (persist ke localStorage; UI switch = fase M1+). */
    switchStore: (key: string) => setActiveStoreKey(key),
  };
}
