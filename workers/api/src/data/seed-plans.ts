/** Fallback katalog plan jika Supabase belum di-wire (dev / bootstrap). */
export interface SeedPlan {
  id: string;
  name: string;
  storageLimitMb: number;
  price: number;
  category: 'STORAGE' | 'SYNC' | 'ADDON';
  maxStores: number | null;
}

/** Satu-satunya paket: Profitku Cloud Rp 25.000/bulan per toko. */
export const CLOUD_PLAN_ID = 'cloud_monthly';
export const CLOUD_PLAN_PRICE_IDR = 25_000;

/** Durasi langganan per toko: 1/6/12 bulan dengan diskon (bayar 5/10 bulan). */
export type CloudDurationMonths = 1 | 6 | 12;

export const CLOUD_DURATIONS: {
  months: CloudDurationMonths;
  priceFactor: number;
  label: string;
}[] = [
  { months: 1, priceFactor: 1, label: '1 bulan' },
  { months: 6, priceFactor: 5, label: '6 bulan (bayar 5)' },
  { months: 12, priceFactor: 10, label: '12 bulan (bayar 10)' },
];

export const DEFAULT_DURATION_MONTHS: CloudDurationMonths = 1;

export function cloudDurationFactor(months: number): number {
  const d = CLOUD_DURATIONS.find((x) => x.months === Number(months));
  return d ? d.priceFactor : 1;
}

export function cloudDurationDays(months: number): number {
  // Billing: 30 hari/bulan (6 → 180, 12 → 360).
  const m = Math.max(1, Math.round(Number(months) || 1));
  return m * 30;
}

export function normalizeDurationMonths(raw: unknown): CloudDurationMonths {
  const n = Number(raw);
  return n === 6 || n === 12 ? n : DEFAULT_DURATION_MONTHS;
}

export const SEED_PLANS: SeedPlan[] = [
  {
    id: CLOUD_PLAN_ID,
    name: 'Profitku Cloud',
    storageLimitMb: 1024,
    price: CLOUD_PLAN_PRICE_IDR,
    category: 'SYNC',
    maxStores: 1,
  },
];
