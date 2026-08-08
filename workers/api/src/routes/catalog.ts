/**
 * Profitku API — Katalog publik (/api/plans, /api/app-settings/:key)
 */
import { Hono } from 'hono';
import type { AppEnv } from './helpers';
import { sbGet } from '../lib/supabase';
import { SEED_PLANS } from '../data/seed-plans';

const catalogRoutes = new Hono<AppEnv>();

// --- Plans ---
catalogRoutes.get('/plans', async (c) => {
  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type Row = {
        id: string;
        name: string;
        storage_limit_mb: number;
        price_idr: number;
        category: string;
        max_stores: number | null;
      };
      const rows = await sbGet<Row[]>(
        c.env,
        'plans?is_active=eq.true&order=sort_order.asc&select=id,name,storage_limit_mb,price_idr,category,max_stores',
      );
      const plans = rows.map((r) => ({
        id: r.id,
        name: r.name,
        storageLimitMb: r.storage_limit_mb,
        price: r.price_idr,
        category: r.category,
        maxStores: r.max_stores,
      }));
      return c.json({ plans });
    }
  } catch (err) {
    console.warn('[plans] supabase fallback seed', err);
  }
  return c.json({ plans: SEED_PLANS });
});

// --- App Settings (public read) ---
const APP_SETTINGS_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

catalogRoutes.get('/app-settings/:key', async (c) => {
  const key = c.req.param('key');
  // Whitelist key untuk mencegah injeksi filter PostgREST (key dipakai dalam `key=eq.${key}`).
  if (!APP_SETTINGS_KEY_RE.test(key)) {
    return c.json({ error: 'Setting not found' }, 404);
  }
  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY) {
      type Row = {
        key: string;
        value: Record<string, unknown>;
        description: string | null;
        updated_at: string;
      };
      const rows = await sbGet<Row[]>(c.env, `app_settings?key=eq.${key}&select=*&limit=1`);
      if (rows.length > 0) {
        const row = rows[0];
        return c.json({
          key: row.key,
          value: row.value,
          description: row.description,
          updatedAt: row.updated_at,
        });
      }
    }
  } catch (err) {
    console.warn(`[app-settings:${key}]`, err);
  }
  return c.json({ error: 'Setting not found' }, 404);
});

export default catalogRoutes;
