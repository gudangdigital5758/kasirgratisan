/**
 * Profitku API — Sync lintas perangkat (/api/sync/*, /api/stores/:storeId/sync)
 * LWW server-side via RPC sync_upsert_batch. Guard: auth + has_sync + kepemilikan store.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { handlePushSync, requireSyncStore } from './helpers';
import { sbGet, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

const syncRoutes = new Hono<AppEnv>();

syncRoutes.post('/sync/push', (c: AppContext) => handlePushSync(c));

syncRoutes.post('/stores/:storeId/sync', (c: AppContext) => handlePushSync(c, c.req.param('storeId')));

export type SyncRow = {
  id: number;
  table_name: string;
  sync_id: string;
  data: unknown;
  server_updated_at: string;
  deleted: boolean;
  deleted_at: string | null;
};

/** Ukuran batch pull (CLOUD-004). */
const PULL_BATCH = 2000;

type PullCursor = { time: string; id: number };

/**
 * Cursor keyset: `ISO_UPDATED_AT|ROW_ID`.
 *
 * `id:<n>` adalah cursor sementara dari implementasi sebelumnya. Jangan
 * melanjutkan dari ID tersebut karena upsert existing row mempertahankan ID;
 * replay dari epoch memastikan update yang mungkin terlewat ditemukan.
 */
function parsePullCursor(raw: string): PullCursor {
  if (raw.startsWith('id:')) {
    return { time: new Date(0).toISOString(), id: 0 };
  }
  const separator = raw.lastIndexOf('|');
  if (separator > 0) {
    const time = raw.slice(0, separator);
    const id = Number(raw.slice(separator + 1));
    if (!Number.isNaN(Date.parse(time)) && Number.isInteger(id) && id >= 0) {
      return { time: new Date(time).toISOString(), id };
    }
  }
  if (!Number.isNaN(Date.parse(raw))) {
    return { time: new Date(raw).toISOString(), id: 0 };
  }
  throw new Error('since tidak valid');
}

function encodePullCursor(row: Pick<SyncRow, 'server_updated_at' | 'id'>): string {
  return `${new Date(row.server_updated_at).toISOString()}|${row.id}`;
}

syncRoutes.get('/sync/pull', async (c: AppContext) => {
  const storeId = c.req.query('storeId') ?? '';
  if (!storeId) return c.json({ error: 'storeId wajib' }, 400);
  if (c.env.SYNC_ENABLED === 'false') {
    return c.json({ error: 'Sinkronisasi lintas perangkat sedang dinonaktifkan sementara' }, 503);
  }
  const guard = await requireSyncStore(c, storeId);
  if (guard) return guard;
  const since = c.req.query('since') ?? '';
  if (!since) return c.json({ error: 'since wajib' }, 400);

  let cursor: PullCursor;
  try {
    cursor = parsePullCursor(since);
  } catch {
    return c.json({ error: 'since tidak valid' }, 400);
  }

  try {
    const rows = await sbGet<SyncRow[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}` +
        `&or=(server_updated_at.gt.${encodeURIComponent(cursor.time)},and(server_updated_at.eq.${encodeURIComponent(cursor.time)},id.gt.${cursor.id}))` +
        '&order=server_updated_at.asc,id.asc' +
        `&limit=${PULL_BATCH + 1}` +
        '&select=id,table_name,sync_id,data,server_updated_at,deleted,deleted_at',
    );
    const hasMore = rows.length > PULL_BATCH;
    const page = hasMore ? rows.slice(0, PULL_BATCH) : rows;
    const pageCursor = page.length > 0
      ? encodePullCursor(page[page.length - 1])
      : since;
    const records = page
      .filter((r) => !r.deleted)
      .map((r) => ({ table: r.table_name, syncId: r.sync_id, data: r.data, updatedAt: r.server_updated_at }));
    const tombstones = page
      .filter((r) => r.deleted)
      .map((r) => ({ table: r.table_name, syncId: r.sync_id, deletedAt: r.deleted_at ?? r.server_updated_at }));
    await writeEvent(c.env, {
      type: 'sync_pull',
      message: `pull ${records.length + tombstones.length} changes`,
      actorUserId: c.get('userId'),
      payload: { records: records.length, tombstones: tombstones.length, hasMore },
    });
    return c.json({
      records,
      tombstones,
      serverTime: new Date().toISOString(),
      nextCursor: hasMore ? pageCursor : undefined,
      cursor: pageCursor,
      hasMore,
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[sync pull]', err);
    return c.json({ error: 'Gagal menarik data sync' }, 500);
  }
});

export default syncRoutes;
