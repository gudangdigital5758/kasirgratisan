/**
 * Profitku API — Keuangan Online (/api/finance/*)
 * Pengeluaran (expenses), pembayaran hutang (fn_online_debt_payment),
 * stok masuk/keluar (fn_online_stock_move). Semua ditulis ke sync_records (LWW pull).
 * Akses: role dengan menu 'finance' (default: owner/admin/kepala_gudang).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireActiveSubscription, requireMenu, requireUser } from './helpers';
import { sbGet, sbPatch, sbPost, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

const financeRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = { id: string; sync_id: string; data: Record<string, unknown>; server_updated_at: string };

const actorName = (c: AppContext, userId: string) =>
  userId.startsWith('team:') ? userId : c.get('userEmail') || 'owner';

/** Ekstrak pesan RPC (raise exception PostgREST ada di body). */
function rpcMessage(err: unknown): string {
  const body = err instanceof SupabaseError ? String(err.body ?? '') : '';
  const m = /"message":"([^"]+)"/.exec(body);
  if (m) return m[1].replace(/\\"/g, '"');
  return err instanceof SupabaseError ? String(err.message) : 'Operasi gagal, coba lagi';
}

async function guardStore(c: AppContext, storeId: string, menuKey = 'finance'): Promise<Response | null> {
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const menuGuard = await requireMenu(c, storeId, menuKey);
  if (menuGuard) return menuGuard;
  return null;
}

// === Pengeluaran ===

financeRoutes.get('/finance/expenses', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 50) : 20;
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.expenses&deleted=eq.false&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
    );
    const expenses = (rows ?? []).filter((r) => String(r.data?.isDeleted ?? 0) !== '1');
    return c.json({
      expenses: expenses.map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance expenses list]', err);
    return c.json({ error: 'Gagal memuat pengeluaran' }, 500);
  }
});
financeRoutes.post('/finance/expenses', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    title?: string;
    amount?: number;
    categoryName?: string;
    date?: string;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;

  const title = String(body.title ?? '').trim().slice(0, 120);
  const amount = Number(body.amount);
  if (!title) return c.json({ error: 'Judul pengeluaran wajib' }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'Jumlah harus lebih dari 0' }, 400);
  const dateRaw = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(dateRaw.getTime())) return c.json({ error: 'Tanggal tidak valid' }, 400);
  const iso = dateRaw.toISOString();
  const syncId = crypto.randomUUID();

  try {
    await sbPost(c.env, 'sync_records', {
      store_id: storeId,
      table_name: 'expenses',
      sync_id: syncId,
      data: {
        title,
        amount,
        categoryId: null,
        categorySyncId: null,
        categoryName: String(body.categoryName ?? '').trim().slice(0, 60) || 'Umum',
        date: iso,
        notes: String(body.notes ?? '').trim().slice(0, 300),
        createdAt: iso,
        createdBy: null,
        createdByName: actorName(c, userId),
        isDeleted: 0,
        deletedAt: null,
        updatedAt: iso,
      },
      deleted: false,
      server_updated_at: iso,
      client_updated_at: iso,
    });
    await writeEvent(c.env, {
      type: 'online_expense',
      message: `Pengeluaran: ${title} (${amount})`,
      actorUserId: userId,
      payload: { storeId, amount },
    }).catch(() => undefined);
    return c.json({ ok: true, syncId });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance expense create]', err);
    return c.json({ error: 'Gagal menyimpan pengeluaran' }, 500);
  }
});

financeRoutes.delete('/finance/expenses/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const syncId = c.req.param('syncId') ?? '';
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.expenses&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Pengeluaran tidak ditemukan' }, 404);
    const iso = new Date().toISOString();
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, isDeleted: 1, deletedAt: iso, updatedAt: iso },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance expense delete]', err);
    return c.json({ error: 'Gagal menghapus pengeluaran' }, 500);
  }
});
// === Hutang ===

financeRoutes.get('/finance/debts', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.debts&deleted=eq.false&order=server_updated_at.desc&limit=200&select=id,sync_id,data,server_updated_at`,
    );
    const debts = (rows ?? []).filter((r) => String(r.data?.status ?? 'active') !== 'settled');
    return c.json({
      debts: debts.map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance debts list]', err);
    return c.json({ error: 'Gagal memuat hutang' }, 500);
  }
});

financeRoutes.post('/finance/debts/:syncId/pay', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const syncId = c.req.param('syncId') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    amount?: number;
    method?: string;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'Jumlah bayar harus lebih dari 0' }, 400);
  try {
    const result = await sbPost<{ ok: boolean; remainingAmount: number; status: string }>(
      c.env,
      'rpc/fn_online_debt_payment',
      {
        p_store_id: storeId,
        p_debt_sync_id: syncId,
        p_amount: amount,
        p_method: String(body.method ?? '').trim().slice(0, 40) || 'Tunai',
        p_notes: String(body.notes ?? '').trim().slice(0, 300),
        p_created_by: actorName(c, userId),
      },
    );
    await writeEvent(c.env, {
      type: 'online_debt_payment',
      message: `Bayar hutang ${syncId.slice(0, 8)}: ${amount}`,
      actorUserId: userId,
      payload: { storeId, amount },
    }).catch(() => undefined);
    return c.json({ ok: true, remainingAmount: result.remainingAmount, status: result.status });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: rpcMessage(err) }, 400);
    console.error('[finance debt pay]', err);
    return c.json({ error: 'Gagal menyimpan pembayaran' }, 500);
  }
});
// === Stok masuk/keluar ===

financeRoutes.get('/finance/stock', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 50) : 30;
  try {
    const [ins, outs] = await Promise.all([
      sbGet<Row[]>(
        c.env,
        `sync_records?store_id=eq.${storeId}&table_name=eq.stockIns&deleted=eq.false&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
      ),
      sbGet<Row[]>(
        c.env,
        `sync_records?store_id=eq.${storeId}&table_name=eq.stockOuts&deleted=eq.false&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
      ),
    ]);
    const items = [
      ...(ins ?? []).map((r) => ({ syncId: r.sync_id, table: 'stockIns' as const, data: r.data, serverUpdatedAt: r.server_updated_at })),
      ...(outs ?? []).map((r) => ({ syncId: r.sync_id, table: 'stockOuts' as const, data: r.data, serverUpdatedAt: r.server_updated_at })),
    ]
      .sort((a, b) => (a.serverUpdatedAt < b.serverUpdatedAt ? 1 : -1))
      .slice(0, limit);
    return c.json({ items });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance stock list]', err);
    return c.json({ error: 'Gagal memuat riwayat stok' }, 500);
  }
});

financeRoutes.post('/finance/stock', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    type?: string;
    productSyncId?: string;
    qty?: number;
    buyPrice?: number;
    reason?: string;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId);
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const type = body.type === 'out' ? 'out' : body.type === 'in' ? 'in' : null;
  if (!type) return c.json({ error: 'Tipe stok harus in/out' }, 400);
  const productSyncId = String(body.productSyncId ?? '').trim();
  if (!UUID_RE.test(productSyncId)) return c.json({ error: 'Produk tidak valid' }, 400);
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 99999) return c.json({ error: 'Jumlah harus 1-99999' }, 400);
  const buyPrice = Number(body.buyPrice);
  if (type === 'in' && (!Number.isFinite(buyPrice) || buyPrice < 0)) {
    return c.json({ error: 'Harga beli tidak valid' }, 400);
  }
  try {
    const result = await sbPost<{ ok: boolean; stock: number }>(c.env, 'rpc/fn_online_stock_move', {
      p_store_id: storeId,
      p_type: type,
      p_product_sync_id: productSyncId,
      p_qty: qty,
      p_buy_price: type === 'in' ? buyPrice : 0,
      p_reason: String(body.reason ?? '').trim().slice(0, 120),
      p_notes: String(body.notes ?? '').trim().slice(0, 300),
      p_created_by: actorName(c, userId),
    });
    await writeEvent(c.env, {
      type: 'online_stock',
      message: `Stok ${type === 'in' ? 'masuk' : 'keluar'}: ${productSyncId.slice(0, 8)} × ${qty}`,
      actorUserId: userId,
      payload: { storeId, type, qty },
    }).catch(() => undefined);
    return c.json({ ok: true, stock: result.stock });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: rpcMessage(err) }, 400);
    console.error('[finance stock move]', err);
    return c.json({ error: 'Gagal memproses stok' }, 500);
  }
});

// === Shift online (menu 'cashier' — workflow kasir) ===

financeRoutes.get('/finance/shifts', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId, 'cashier');
  if (guard) return guard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 20) : 10;
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.cashierShifts&deleted=eq.false&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
    );
    return c.json({
      shifts: (rows ?? []).map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance shifts list]', err);
    return c.json({ error: 'Gagal memuat shift' }, 500);
  }
});

financeRoutes.post('/finance/shifts/open', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { storeId?: string; openingCash?: number };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'cashier');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const openingCash = Number(body.openingCash);
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return c.json({ error: 'Uang awal tidak valid' }, 400);
  }
  const iso = new Date().toISOString();
  const syncId = crypto.randomUUID();
  try {
    await sbPost(c.env, 'sync_records', {
      store_id: storeId,
      table_name: 'cashierShifts',
      sync_id: syncId,
      data: {
        userId: null,
        userName: actorName(c, userId),
        openedAt: iso,
        closedAt: null,
        openingCash,
        closingCash: null,
        expectedCash: null,
        cashSales: 0,
        cashExpenses: 0,
        txCount: 0,
        salesTotal: 0,
        notes: '',
        status: 'open',
        updatedAt: iso,
      },
      deleted: false,
      server_updated_at: iso,
      client_updated_at: iso,
    });
    await writeEvent(c.env, {
      type: 'online_shift_open',
      message: `Shift dibuka (${openingCash})`,
      actorUserId: userId,
      payload: { storeId },
    }).catch(() => undefined);
    return c.json({ ok: true, syncId });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[finance shift open]', err);
    return c.json({ error: 'Gagal membuka shift' }, 500);
  }
});

financeRoutes.post('/finance/shifts/:syncId/close', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const syncId = c.req.param('syncId') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    closingCash?: number;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'cashier');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  const closingCash = Number(body.closingCash);
  if (!Number.isFinite(closingCash) || closingCash < 0) {
    return c.json({ error: 'Uang tunai akhir tidak valid' }, 400);
  }
  try {
    const result = await sbPost<{
      ok: boolean;
      expectedCash: number;
      salesTotal: number;
      txCount: number;
      cashSales: number;
      cashExpenses: number;
    }>(c.env, 'rpc/fn_online_close_shift', {
      p_store_id: storeId,
      p_shift_sync_id: syncId,
      p_closing_cash: closingCash,
      p_notes: String(body.notes ?? '').trim().slice(0, 300),
    });
    await writeEvent(c.env, {
      type: 'online_shift_close',
      message: `Shift ditutup: ${result.txCount} tx, kas ${result.expectedCash}`,
      actorUserId: userId,
      payload: { storeId },
    }).catch(() => undefined);
    return c.json(result);
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: rpcMessage(err) }, 400);
    console.error('[finance shift close]', err);
    return c.json({ error: 'Gagal menutup shift' }, 500);
  }
});

// === Laba-Rugi periode (P&L) ===

financeRoutes.get('/finance/pnl', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId, 'finance');
  if (guard) return guard;
  const fromRaw = new Date(c.req.query('from') ?? '');
  const toRaw = new Date(c.req.query('to') ?? '');
  const from = Number.isNaN(fromRaw.getTime()) ? new Date(Date.now() - 30 * 86400_000) : fromRaw;
  const to = Number.isNaN(toRaw.getTime()) ? new Date() : toRaw;
  try {
    const result = await sbPost<{
      revenue: number;
      profit: number;
      cogs: number;
      expenses: number;
      net: number;
      txCount: number;
      expenseCount: number;
    }>(c.env, 'rpc/fn_online_pnl', {
      p_store_id: storeId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    return c.json({ ok: true, pnl: result });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: rpcMessage(err) }, 400);
    console.error('[finance pnl]', err);
    return c.json({ error: 'Gagal menghitung laba-rugi' }, 500);
  }
});

export default financeRoutes;


