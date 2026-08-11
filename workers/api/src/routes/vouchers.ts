/**
 * Profitku API — Voucher preview (/api/vouchers/preview)
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser } from './helpers';
import { resolveListPrice, validateVoucherForUser } from '../lib/vouchers';
import { cloudDurationFactor, normalizeDurationMonths } from '../data/seed-plans';

const vouchersRoutes = new Hono<AppEnv>();

// --- Voucher preview (auth) ---
vouchersRoutes.post('/vouchers/preview', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    planId?: string;
    durationMonths?: number;
  };
  const planId = body.planId || 'cloud_monthly';
  const code = body.code || '';
  if (!code.trim()) return c.json({ valid: false, error: 'Kode voucher wajib diisi' }, 400);

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ valid: false, error: 'Database belum dikonfigurasi' }, 503);
  }

  const priced = await resolveListPrice(c.env, planId);
  if (!priced.active || priced.category !== 'SYNC') {
    return c.json({ valid: false, error: 'Plan cloud tidak aktif' }, 400);
  }
  const { amount: listPriceBase } = priced;
  // Durasi 6/12 bulan memakai price factor (bayar 5/10 bulan) — harga dihitung server.
  const listPrice = Math.round(listPriceBase * cloudDurationFactor(normalizeDurationMonths(body.durationMonths)));
  const result = await validateVoucherForUser(c.env, {
    code,
    userId: String(userId),
    planId,
    listPrice,
  });
  if (!result.valid) return c.json(result, 200);
  return c.json(result);
});

export default vouchersRoutes;
