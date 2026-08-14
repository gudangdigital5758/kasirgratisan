/**
 * Profitku API - Diskon bertingkat (price_rules), market-only.
 * Owner/admin toko yang mengelola.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireActiveSubscription, requireUser } from './helpers';
import { requireManager } from './team';
import { sbGet, sbPost, sbDelete, SupabaseError } from '../lib/supabase';

const priceRulesRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RuleRow = {
  id: string;
  store_id: string;
  product_sync_id: string;
  min_qty: number;
  discount_percent: number;
  created_at: string;
  updated_at: string;
};

function ruleJson(r: RuleRow) {
  return {
    id: r.id,
    storeId: r.store_id,
    productSyncId: r.product_sync_id,
    minQty: Number(r.min_qty),
    discountPercent: Number(r.discount_percent),
    createdAt: r.created_at,
  };
}

/** Daftar aturan diskon (opsional filter productSyncId). */
priceRulesRoutes.get('/stores/:id/price-rules', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const guard = await requireManager(c, storeId, userId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const productSyncId = c.req.query('productSyncId');
  const filter = productSyncId ? `&product_sync_id=eq.${encodeURIComponent(productSyncId)}` : '';
  try {
    const rows = await sbGet<RuleRow[]>(c.env, `price_rules?store_id=eq.${storeId}${filter}&order=min_qty.asc&select=*&limit=200`);
    return c.json({ rules: (rows ?? []).map(ruleJson) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[price-rules list]', err);
    return c.json({ error: 'Gagal memuat aturan' }, 500);
  }
});

/** Tambah aturan diskon (owner/admin). */
priceRulesRoutes.post('/stores/:id/price-rules', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const guard = await requireManager(c, storeId, userId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const body = (await c.req.json().catch(() => ({}))) as { productSyncId?: string; minQty?: number; discountPercent?: number };
  const productSyncId = String(body.productSyncId ?? '').trim();
  const minQty = Math.floor(Number(body.minQty));
  const discountPercent = Number(body.discountPercent);
  if (!productSyncId || productSyncId.length > 64) return c.json({ error: 'productSyncId wajib' }, 400);
  if (!Number.isFinite(minQty) || minQty < 1) return c.json({ error: 'minQty minimal 1' }, 400);
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    return c.json({ error: 'discountPercent harus 1-100' }, 400);
  }
  try {
    const dup = await sbGet<{ id: string }[]>(
      c.env,
      `price_rules?store_id=eq.${storeId}&product_sync_id=eq.${encodeURIComponent(productSyncId)}&min_qty=eq.${minQty}&select=id&limit=1`,
    );
    if (dup && dup.length > 0) return c.json({ error: 'Aturan untuk produk & qty ini sudah ada' }, 409);
    const inserted = await sbPost<RuleRow[]>(c.env, 'price_rules', {
      store_id: storeId,
      product_sync_id: productSyncId,
      min_qty: minQty,
      discount_percent: discountPercent,
    });
    return c.json({ rule: ruleJson(inserted[0]) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[price-rules create]', err);
    return c.json({ error: 'Gagal menyimpan aturan' }, 500);
  }
});

/** Hapus aturan diskon (owner/admin). */
priceRulesRoutes.delete('/stores/:id/price-rules/:ruleId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  const ruleId = c.req.param('ruleId') ?? '';
  if (!UUID_RE.test(storeId) || !UUID_RE.test(ruleId)) return c.json({ error: 'id tidak valid' }, 400);
  const guard = await requireManager(c, storeId, userId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  try {
    await sbDelete(c.env, `price_rules?id=eq.${ruleId}&store_id=eq.${storeId}`);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[price-rules delete]', err);
    return c.json({ error: 'Gagal menghapus aturan' }, 500);
  }
});

export default priceRulesRoutes;