/**
 * Helper bersama untuk modul route /api/* (pola controller).
 * Diambil dari index.ts agar handler terpisah tanpa duplikasi logika.
 */
import { type Context } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPost, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';
import { SYNC_MAX_BYTES, SYNC_ID_RE, sanitizeSyncData } from '../lib/sync-schema';

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
  'hppHistory', 'stockLots', 'stockLotAllocations', 'paymentMethods', 'transactions', 'transactionItems', 'units',
  'users', 'roles', 'expenseCategories', 'expenses', 'debts', 'debtPayments',
  'stockOpnames', 'stockOpnameItems', 'cashierShifts',
]);
export const SYNC_MAX_RECORDS = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (!UUID_RE.test(storeId)) {
    return c.json({ error: 'storeId tidak valid' }, 400);
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

/**
 * Validasi langganan cloud AKTIF per toko (store_entitlements.has_sync).
 * Source of truth untuk "fitur cloud terkunci sebelum berlangganan":
 * tim & roles, price rules, toko online (market). Auth/ownership sudah
 * diperiksa pemanggil (requireUser / requireManager) — helper ini murni cek
 * entitlement. Status 402 = butuh langganan.
 */
export async function requireActiveSubscription(c: AppContext, storeId: string): Promise<null | Response> {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  try {
    const ent = await sbGet<{ has_sync: boolean }[]>(
      c.env,
      `store_entitlements?store_id=eq.${storeId}&select=has_sync`,
    );
    if (!ent[0]?.has_sync) {
      return c.json({ error: 'Langganan cloud belum aktif untuk toko ini. Aktifkan paket Profitku Cloud (Rp 25.000/bulan) dulu.' }, 402);
    }
    return null;
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[subscription gate]', err);
    return c.json({ error: 'Gagal memvalidasi langganan/toko' }, 500);
  }
}

/** Cek langganan aktif untuk SEMUA storeId. Return Response 402 bila ada yang belum aktif. */
export async function requireActiveSubscriptions(c: AppContext, storeIds: string[]): Promise<null | Response> {
  const uniq = [...new Set(storeIds)].filter(Boolean);
  if (uniq.length === 0) return null;
  for (const id of uniq) {
    const guard = await requireActiveSubscription(c, id);
    if (guard) return guard;
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

  // CLOUD-008: batas ukuran payload total (fail-closed sebelum diproses).
  const rawLength = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (rawLength > SYNC_MAX_BYTES) {
    return c.json({ error: 'Payload sync terlalu besar (maks 5 MB)' }, 413);
  }

  const items: Record<string, unknown>[] = [];

  try {
    for (const [table, rows] of Object.entries(body.records ?? {})) {
      if (!SYNC_TABLES.has(table)) return c.json({ error: `Tabel tidak dikenal: ${table}` }, 400);
      for (const raw of rows ?? []) {
        const r = raw as { syncId?: string; data?: unknown; updatedAt?: string };
        if (!r.syncId || !r.updatedAt) continue;
        // syncId harus UUID (CLOUD-008) dan updatedAt harus timestamp valid.
        if (!SYNC_ID_RE.test(r.syncId)) {
          return c.json({ error: `syncId tidak valid pada tabel ${table}` }, 400);
        }
        if (Number.isNaN(Date.parse(r.updatedAt))) {
          return c.json({ error: `updatedAt tidak valid pada tabel ${table}` }, 400);
        }
        const data = sanitizeSyncData(table, r.data);
        items.push({
          table_name: table,
          sync_id: r.syncId,
          data,
          updated_at: r.updatedAt,
          deleted: false,
          deleted_at: null,
        });
      }
    }
    for (const t of body.tombstones ?? []) {
      if (!t?.table || !SYNC_TABLES.has(t.table) || !t.syncId || !t.deletedAt) continue;
      if (!SYNC_ID_RE.test(t.syncId)) {
        return c.json({ error: `syncId tombstone tidak valid pada tabel ${t.table}` }, 400);
      }
      if (Number.isNaN(Date.parse(t.deletedAt))) continue;
      items.push({
        table_name: t.table,
        sync_id: t.syncId,
        data: {},
        updated_at: t.deletedAt,
        deleted: true,
        deleted_at: t.deletedAt,
      });
    }
  } catch (err) {
    if (err instanceof Error) {
      return c.json({ error: err.message }, 400);
    }
    return c.json({ error: 'Payload sync tidak valid' }, 400);
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
    // Backward-compatible with the pre-winner RPC (array response) while the
    // new migration is rolled out. New RPC returns { accepted, winners }.
    const rpcResult = await sbPost<
      string[] | { accepted?: string[]; winners?: unknown[] }
    >(c.env, 'rpc/sync_upsert_batch', {
      p_store_id: storeId,
      p_items: items,
    });
    const accepted = Array.isArray(rpcResult) ? rpcResult : rpcResult.accepted ?? [];
    const winners = Array.isArray(rpcResult) ? [] : rpcResult.winners ?? [];
    await writeEvent(c.env, {
      type: 'sync_push',
      message: `push ${accepted?.length ?? 0} records`,
      actorUserId: c.get('userId'),
      payload: { count: accepted.length, winners: winners.length, tables: Object.keys(body.records ?? {}) },
    });
    return c.json({ accepted, count: accepted.length, winners, serverTime: new Date().toISOString() });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[sync push]', err);
    return c.json({ error: 'Gagal menyimpan data sync' }, 500);
  }
}
