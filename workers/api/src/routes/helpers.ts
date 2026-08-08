/**
 * Helper bersama untuk modul route /api/* (pola controller).
 * Diambil dari index.ts agar handler terpisah tanpa duplikasi logika.
 */
import { type Context } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPost, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;

export function requireUser(c: AppContext): string | Response {
  const id = c.get('userId');
  if (!id) return c.json({ error: 'Belum login' }, 401);
  return id;
}

/** Validasi kepemilikan toko (opsional). Return null bila tanpa storeId. */
export async function resolveOwnedStoreId(
  c: AppContext,
  userId: string,
  storeIdRaw?: string | null,
): Promise<string | null | Response> {
  if (!storeIdRaw) return null;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Database belum dikonfigurasi' }, 503);
  }
  try {
    const rows = await sbGet<{ id: string }[]>(
      c.env,
      `stores?id=eq.${storeIdRaw}&user_id=eq.${userId}&select=id`,
    );
    if (!rows[0]) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 400);
    return rows[0].id;
  } catch (err) {
    console.warn('[checkout store]', err);
    return c.json({ error: 'Gagal memvalidasi toko' }, 500);
  }
}

// === Sync lintas perangkat (Phase A M1) ===
// LWW server-side via RPC sync_upsert_batch. Guard: auth + has_sync + kepemilikan store.

export const SYNC_TABLES = new Set([
  'categories', 'products', 'suppliers', 'customers', 'stockIns', 'stockOuts',
  'hppHistory', 'paymentMethods', 'transactions', 'transactionItems', 'units',
  'users', 'roles', 'expenseCategories', 'expenses', 'debts', 'debtPayments',
  'stockOpnames', 'stockOpnameItems', 'cashierShifts',
]);
export const SYNC_MAX_RECORDS = 2000;

export type SyncRow = {
  table_name: string;
  sync_id: string;
  data: unknown;
  server_updated_at: string;
  deleted: boolean;
  deleted_at: string | null;
};

/** Validasi auth + langganan sync + kepemilikan store. Return Response bila gagal. */
export async function requireSyncStore(c: AppContext, storeId: string): Promise<null | Response> {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    // Kepemilikan toko + entitlement langganan PER TOKO (model per-toko berbayar).
    const stores = await sbGet<{ id: string }[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id`,
    );
    if (!stores[0]) {
      return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    }
    const ent = await sbGet<{ has_sync: boolean }[]>(
      c.env,
      `store_entitlements?store_id=eq.${storeId}&select=has_sync`,
    );
    if (!ent[0]?.has_sync) {
      return c.json({ error: 'Langganan sinkronisasi toko ini tidak aktif' }, 403);
    }
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[sync guard]', err);
    return c.json({ error: 'Gagal memvalidasi langganan/toko' }, 500);
  }
  return null;
}

export async function handlePushSync(c: AppContext, explicitStoreId?: string) {
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    records?: Record<string, unknown[]>;
    tombstones?: { table?: string; syncId?: string; deletedAt?: string }[];
    deviceId?: string;
    deviceName?: string;
  };
  const storeId = explicitStoreId ?? String(body.storeId ?? '');
  if (!storeId) return c.json({ error: 'storeId wajib' }, 400);
  if (c.env.SYNC_ENABLED === 'false') {
    return c.json({ error: 'Sinkronisasi lintas perangkat sedang dinonaktifkan sementara' }, 503);
  }

  const guard = await requireSyncStore(c, storeId);
  if (guard) return guard;

  const items: Record<string, unknown>[] = [];

  for (const [table, rows] of Object.entries(body.records ?? {})) {
    if (!SYNC_TABLES.has(table)) return c.json({ error: `Tabel tidak dikenal: ${table}` }, 400);
    for (const raw of rows ?? []) {
      const r = raw as { syncId?: string; data?: unknown; updatedAt?: string };
      if (!r.syncId || !r.updatedAt) continue;
      items.push({
        table_name: table,
        sync_id: r.syncId,
        data: r.data ?? {},
        updated_at: r.updatedAt,
        deleted: false,
        deleted_at: null,
      });
    }
  }
  for (const t of body.tombstones ?? []) {
    if (!t?.table || !SYNC_TABLES.has(t.table) || !t.syncId || !t.deletedAt) continue;
    items.push({
      table_name: t.table,
      sync_id: t.syncId,
      data: {},
      updated_at: t.deletedAt,
      deleted: true,
      deleted_at: t.deletedAt,
    });
  }
  if (items.length === 0) return c.json({ error: 'Tidak ada record valid untuk di-push' }, 400);
  if (items.length > SYNC_MAX_RECORDS) return c.json({ error: 'Batch terlalu besar (maks 2000)' }, 413);

  try {
    if (body.deviceId) {
      try {
        await sbPost(c.env, 'rpc/sync_register_device', {
          p_store_id: storeId,
          p_device_id: body.deviceId,
          p_device_name: body.deviceName ?? '',
        });
      } catch {
        // best-effort — jangan gagalkan push karena device metadata
      }
    }
    const accepted = await sbPost<string[]>(c.env, 'rpc/sync_upsert_batch', {
      p_store_id: storeId,
      p_items: items,
    });
    await writeEvent(c.env, {
      type: 'sync_push',
      message: `push ${accepted?.length ?? 0} records`,
      actorUserId: c.get('userId'),
      payload: { count: accepted?.length ?? 0, tables: Object.keys(body.records ?? {}) },
    });
    return c.json({ accepted: accepted ?? [], count: accepted?.length ?? 0, serverTime: new Date().toISOString() });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[sync push]', err);
    return c.json({ error: 'Gagal menyimpan data sync' }, 500);
  }
}
