/**
 * Profitku API — Stores (/api/stores, /api/stores/:id)
 * Model per-toko berbayar: semua user boleh membuat toko (unlimited);
 * langganan cloud ditentukan per toko (store_entitlements).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser } from './helpers';
import { sbGet, sbPost, sbDelete, SupabaseError } from '../lib/supabase';
import { deleteBackupObject } from '../lib/backups';

const storesRoutes = new Hono<AppEnv>();

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
