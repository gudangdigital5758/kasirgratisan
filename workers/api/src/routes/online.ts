/**
 * Profitku API — Kasir Online (/api/online/*)
 * Checkout atomik via fn_online_checkout (sync_records + stok). Harga/HPP dari server.
 * Akses: role dengan menu 'cashier' (default: owner/admin/kasir).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireActiveSubscription, requireMenu, requireUser } from './helpers';
import { sbGet, sbPost, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

const onlineRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutItem = { productSyncId?: string; qty?: number };

/** Ekstrak pesan error RPC (raise exception PostgREST ada di body) jadi user-friendly. */
function rpcError(err: unknown): string {
  const body = err instanceof SupabaseError ? String(err.body ?? '') : '';
  const m = /"message":"([^"]+)"/.exec(body);
  if (m) return m[1].replace(/\\"/g, '"');
  return err instanceof SupabaseError ? String(err.message) : 'Checkout gagal, coba lagi';
}

onlineRoutes.post('/online/checkout', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    items?: CheckoutItem[];
    paymentMethodName?: string;
    paymentAmount?: number;
  };
  const storeId = String(body.storeId ?? '').trim();
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const menuGuard = await requireMenu(c, storeId, 'cashier');
  if (menuGuard) return menuGuard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;

  const items = (body.items ?? [])
    .filter(
      (i) =>
        i &&
        typeof i.productSyncId === 'string' &&
        UUID_RE.test(i.productSyncId) &&
        Number(i.qty) > 0,
    )
    .map((i) => ({ productSyncId: i.productSyncId as string, qty: Math.min(Math.floor(Number(i.qty)), 9999) }));
  if (items.length === 0) return c.json({ error: 'Keranjang kosong' }, 400);
  if (items.length > 100) return c.json({ error: 'Maksimal 100 item per transaksi' }, 400);

  const paymentMethodName = String(body.paymentMethodName ?? '').trim().slice(0, 40) || 'Tunai';
  const paymentAmount = Number(body.paymentAmount);
  const paid = Number.isFinite(paymentAmount) && paymentAmount >= 0 ? paymentAmount : 0;
  const receiptNumber = `OL-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
  const cashier = userId.startsWith('team:') ? userId : c.get('userEmail') || 'owner';

  try {
    const result = await sbPost<{ ok: boolean; transactionSyncId: string; receiptNumber: string }>(
      c.env,
      'rpc/fn_online_checkout',
      {
        p_store_id: storeId,
        p_cashier: cashier,
        p_payment_method_name: paymentMethodName,
        p_receipt_number: receiptNumber,
        p_payment_amount: paid,
        p_items: items,
      },
    );
    await writeEvent(c.env, {
      type: 'online_checkout',
      message: `Kasir online: ${result.receiptNumber} (${items.length} item)`,
      actorUserId: userId,
      payload: { storeId, totalItems: items.length },
    }).catch(() => undefined);
    return c.json({
      ok: true,
      transactionSyncId: result.transactionSyncId,
      receiptNumber: result.receiptNumber,
    });
  } catch (err) {
    if (err instanceof SupabaseError) {
      return c.json({ error: rpcError(err) }, 400);
    }
    console.error('[online checkout]', err);
    return c.json({ error: 'Checkout gagal, coba lagi' }, 500);
  }
});

/** Riwayat transaksi kasir online (20 terakhir). */
onlineRoutes.get('/online/history', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const menuGuard = await requireMenu(c, storeId, 'cashier');
  if (menuGuard) return menuGuard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 50) : 20;
  try {
    const rows = await sbGet<
      { sync_id: string; data: Record<string, unknown>; server_updated_at: string }[]
    >(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.transactions&deleted=eq.false&order=server_updated_at.desc&limit=${limit}&select=sync_id,data,server_updated_at`,
    );
    return c.json({
      transactions: (rows ?? []).map((r) => ({
        syncId: r.sync_id,
        data: r.data,
        serverUpdatedAt: r.server_updated_at,
      })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[online history]', err);
    return c.json({ error: 'Gagal memuat riwayat' }, 500);
  }
});

export default onlineRoutes;
