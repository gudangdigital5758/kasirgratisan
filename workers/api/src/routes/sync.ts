/**
 * Profitku API — Sync lintas perangkat (/api/sync/*, /api/stores/:storeId/sync)
 * LWW server-side via RPC sync_upsert_batch. Guard: auth + has_sync + kepemilikan store.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { handlePushSync, requireSyncStore, type SyncRow } from './helpers';
import { sbGet, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

const syncRoutes = new Hono<AppEnv>();

syncRoutes.post('/sync/push', (c: AppContext) => handlePushSync(c));

syncRoutes.post('/stores/:storeId/sync', (c: AppContext) => handlePushSync(c, c.req.param('storeId')));

syncRoutes.get('/sync/pull', async (c: AppContext) => {
  const storeId = c.req.query('storeId') ?? '';
  if (!storeId) return c.json({ error: 'storeId wajib' }, 400);
  if (c.env.SYNC_ENABLED === 'false') {
    return c.json({ error: 'Sinkronisasi lintas perangkat sedang dinonaktifkan sementara' }, 503);
  }
  const guard = await requireSyncStore(c, storeId);
  if (guard) return guard;
  const since = c.req.query('since') ?? '';
  if (!since) return c.json({ error: 'since wajib (ISO time)' }, 400);

  try {
    const rows = await sbGet<SyncRow[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&server_updated_at=gt.${encodeURIComponent(since)}` +
        '&order=server_updated_at.asc&limit=5000&select=table_name,sync_id,data,server_updated_at,deleted,deleted_at',
    );
    const records = rows
      .filter((r) => !r.deleted)
      .map((r) => ({ table: r.table_name, syncId: r.sync_id, data: r.data, updatedAt: r.server_updated_at }));
    const tombstones = rows
      .filter((r) => r.deleted)
      .map((r) => ({ table: r.table_name, syncId: r.sync_id, deletedAt: r.deleted_at ?? r.server_updated_at }));
    await writeEvent(c.env, {
      type: 'sync_pull',
      message: `pull ${records.length + tombstones.length} changes`,
      actorUserId: c.get('userId'),
      payload: { records: records.length, tombstones: tombstones.length },
    });
    return c.json({ records, tombstones, serverTime: new Date().toISOString() });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[sync pull]', err);
    return c.json({ error: 'Gagal menarik data sync' }, 500);
  }
});

export default syncRoutes;
