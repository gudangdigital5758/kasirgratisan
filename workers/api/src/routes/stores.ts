/**
 * Profitku API — Stores (/api/stores, /api/stores/:id)
 * Model per-toko berbayar: semua user boleh membuat toko (unlimited);
 * langganan cloud ditentukan per toko (store_entitlements).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireSyncStore, requireUser } from './helpers';
import { sbGet, sbPost, sbPatch, sbDelete, SupabaseError } from '../lib/supabase';
import { deleteBackupObject } from '../lib/backups';

const storesRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Stores (minimal) ---
storesRoutes.get('/stores', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type S = {
        id: string;
        user_id: string;
        name: string;
        created_at: string;
        updated_at: string;
        is_public: boolean;
        identifier: string | null;
      };
      type StoreEnt = {
        store_id: string;
        has_sync: boolean;
        sync_expiry: string | null;
        is_lifetime: boolean;
        storage_limit_mb: number;
        backup_bytes: number | string;
      };
      const rows = await sbGet<S[]>(c.env, `stores?user_id=eq.${userId}&order=created_at.desc&select=*`);
      const ents = await sbGet<StoreEnt[]>(
        c.env,
        `store_entitlements?user_id=eq.${userId}&select=store_id,has_sync,sync_expiry,is_lifetime,storage_limit_mb,backup_bytes`,
      ).catch(() => [] as StoreEnt[]);
      const entByStore = new Map(ents.map((e) => [e.store_id, e]));
      return c.json({
        stores: rows.map((s) => {
          const e = entByStore.get(s.id);
          const backupBytes = e ? Number(e.backup_bytes ?? 0) : 0;
          return {
            id: s.id,
            userId: s.user_id,
            name: s.name,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            isPublic: s.is_public,
            identifier: s.identifier,
            entitlement: e
              ? {
                  hasSync: e.has_sync,
                  syncExpiry: e.sync_expiry,
                  isLifetime: e.is_lifetime,
                  storageLimitMb: e.storage_limit_mb || 0,
                  backupBytes,
                  usedMb: Number((backupBytes / (1024 * 1024)).toFixed(2)),
                  remainingMb: Math.max(
                    0,
                    Number(((e.storage_limit_mb || 0) - backupBytes / (1024 * 1024)).toFixed(2)),
                  ),
                }
              : null,
          };
        }),
      });
    }
  } catch (err) {
    console.warn('[stores]', err);
  }
  return c.json({ stores: [] });
});

storesRoutes.post('/stores', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return c.json({ error: 'Nama toko wajib' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    type S = {
      id: string;
      user_id: string;
      name: string;
      created_at: string;
      updated_at: string;
    };

    // Model per-toko berbayar: semua user boleh membuat toko (unlimited).
    // Langganan cloud ditentukan per toko (store_entitlements), bukan jumlah toko.
    const result = await sbPost<S[] | S>(c.env, 'rpc/create_store_with_limit', {
      p_user_id: userId,
      p_name: body.name.trim(),
      p_max_stores: null,
    });
    const s = Array.isArray(result) ? result[0] : result;
    if (!s) return c.json({ error: 'Gagal membuat toko cloud' }, 500);
    return c.json({
      store: {
        id: s.id,
        userId: s.user_id,
        name: s.name,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores create]', err);
    return c.json({ error: 'Gagal membuat toko cloud' }, 500);
  }
});

/** Rename toko (CLOUD-012). */
storesRoutes.put('/stores/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return c.json({ error: 'Nama toko wajib' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    type S = {
      id: string;
      user_id: string;
      name: string;
      created_at: string;
      updated_at: string;
      is_public: boolean;
      identifier: string | null;
    };
    const rows = await sbPatch<S[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      { name: body.name.trim() },
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({
      store: {
        id: s.id,
        userId: s.user_id,
        name: s.name,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        isPublic: s.is_public,
        identifier: s.identifier,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores rename]', err);
    return c.json({ error: 'Gagal mengubah nama toko' }, 500);
  }
});

/** Claim subscription lama level akun ke toko cloud yang dipilih user. */
storesRoutes.post('/stores/:id/claim-legacy-subscription', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as { moveLegacyBackups?: boolean };
  try {
    const result = await sbPost<{
      claimed: boolean;
      reason?: string;
      subscriptionId?: string;
      periodEnd?: string;
      isLifetime?: boolean;
      movedBackupCount?: number;
    }>(c.env, 'rpc/claim_legacy_subscription', {
      p_user_id: userId,
      p_store_id: storeId,
      p_move_legacy_backups: body.moveLegacyBackups === true,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores claim legacy]', err);
    return c.json({ error: 'Gagal menghubungkan subscription lama ke toko' }, 500);
  }
});

/** Bind device kedua ke cloud store existing yang sudah aktif. */
storesRoutes.post('/stores/:id/bind-device', async (c: AppContext) => {
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const guard = await requireSyncStore(c, storeId);
  if (guard) return guard;

  const body = (await c.req.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceName?: string;
  };
  const deviceId = String(body.deviceId || '').trim();
  const deviceName = String(body.deviceName || '').trim().slice(0, 120);
  if (!deviceId || deviceId.length > 128) return c.json({ error: 'deviceId wajib' }, 400);

  try {
    await sbPost(c.env, 'rpc/sync_register_device', {
      p_store_id: storeId,
      p_device_id: deviceId,
      p_device_name: deviceName,
    });
    return c.json({ ok: true, storeId, deviceId, deviceName });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores bind device]', err);
    return c.json({ error: 'Gagal menghubungkan device ke toko cloud' }, 500);
  }
});

/**
 * DELETE /api/stores/:id — hapus toko cloud milik user secara permanen.
 * Menghapus:
 *  - objek backup di R2 + metadata di tabel backups
 *  - baris stores (cascade: sync_records, sync_devices, sync_pull_watermarks,
 *    subscriptions.store_id). payments.store_id di-set null (riwayat keuangan &
 *    komisi affiliate tetap tersimpan).
 * Idempotent: jika toko sudah tidak ada → 200 ok.
 */
storesRoutes.delete('/stores/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id');
  if (!UUID_RE.test(storeId ?? '')) return c.json({ error: 'storeId tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    // Pastikan toko milik user ini.
    const owned = await sbGet<{ id: string }[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id`,
    );
    if (!owned[0]) return c.json({ ok: true }); // sudah tidak ada / bukan miliknya

    // 1) Hapus backup cloud toko (R2 + metadata) — data toko tutup tidak perlu disimpan.
    const backups = await sbGet<
      { id: string; file_key: string }[]
    >(c.env, `backups?store_id=eq.${storeId}&user_id=eq.${userId}&select=id,file_key`).catch(
      () => [] as { id: string; file_key: string }[],
    );
    for (const b of backups) {
      try {
        await deleteBackupObject(c.env, b.file_key);
      } catch (e) {
        console.warn('[stores delete] backup object', b.file_key, e);
      }
      try {
        await sbDelete(c.env, `backups?id=eq.${b.id}`);
      } catch (e) {
        console.warn('[stores delete] backup meta', b.id, e);
      }
    }

    // 2) Hapus baris toko (cascade sync/subscription).
    await sbDelete(c.env, `stores?id=eq.${storeId}&user_id=eq.${userId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[stores delete]', err);
    return c.json({ error: 'Gagal menghapus toko' }, 500);
  }
});

export default storesRoutes;
