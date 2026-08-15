/**
 * Konfigurasi cloud terpusat — harga durasi langganan.
 * Faktor harga (1/5/10) dibaca dari app_settings['cloud_durations']
 * (bisa diubah admin tanpa deploy). Fallback ke seed statis bila key
 * tidak ada / rusak. Harga final = plan price x faktor.
 */
import type { Env } from '../env';
import { sbGet } from './supabase';
import { cloudDurationFactor as staticFactor } from '../data/seed-plans';

type DurationItem = { months?: number; priceFactor?: number };

export async function cloudDurationFactor(env: Env, months: number): Promise<number> {
  try {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const rows = await sbGet<{ value: { items?: DurationItem[] } }[]>(
        env,
        'app_settings?key=eq.cloud_durations&select=value&limit=1',
      );
      const item = rows[0]?.value?.items?.find((i) => i.months === Number(months));
      const f = Number(item?.priceFactor);
      if (Number.isFinite(f) && f > 0) return f;
    }
  } catch (err) {
    console.warn('[cloud_durations]', err);
  }
  return staticFactor(months);
}
