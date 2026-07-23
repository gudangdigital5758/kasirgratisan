/** Fallback katalog plan jika Supabase belum di-wire (dev / bootstrap). */
export interface SeedPlan {
  id: string;
  name: string;
  storageLimitMb: number;
  price: number;
  category: 'STORAGE' | 'SYNC' | 'ADDON';
  maxStores: number | null;
}

/** Satu-satunya paket: Profitku Cloud Rp 25.000/bulan. */
export const CLOUD_PLAN_ID = 'cloud_monthly';
export const CLOUD_PLAN_PRICE_IDR = 25_000;

export const SEED_PLANS: SeedPlan[] = [
  {
    id: CLOUD_PLAN_ID,
    name: 'Profitku Cloud',
    storageLimitMb: 2048,
    price: CLOUD_PLAN_PRICE_IDR,
    category: 'SYNC',
    maxStores: 1,
  },
];
