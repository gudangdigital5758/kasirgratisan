/**
 * Profitku API — Backups (/api/backups, /api/backups/:id/...)
 * Objek di R2 + metadata di Supabase.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser } from './helpers';
import { sbGet, sbPost, sbPatch, sbDelete } from '../lib/supabase';
import {
  deleteBackupMeta,
  deleteBackupObject,
  fileKeyFor,
  getBackupMeta,
  getBackupObject,
  insertBackupMeta,
  listBackupMeta,
  putBackupObject,
  r2Configured,
} from '../lib/backups';

const backupsRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Backups (R2 + metadata Supabase) ---
backupsRoutes.get('/backups', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  if (storeId && !UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  if (storeId) {
    const own = await sbGet<{ id: string }[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id`,
    ).catch(() => [] as { id: string }[]);
    if (!own[0]) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
  }

  try {
    const rows = await listBackupMeta(c.env, String(userId), 50, storeId || undefined);
    const backups = rows.map((b) => ({
      id: b.id,
      storeId: b.store_id,
      fileName: b.file_name,
      fileSize: b.file_size,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
    return c.json({
      backups,
      pagination: {
        page: 1,
        limit: 50,
        totalItems: backups.length,
        totalPages: 1,
        hasMore: false,
      },
    });
  } catch (err) {
    console.warn('[backups list]', err);
    return c.json({
      backups: [],
      pagination: { page: 1, limit: 50, totalItems: 0, totalPages: 1, hasMore: false },
    });
  }
});

backupsRoutes.post('/backups', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  if (!r2Configured(c.env)) {
    return c.json(
      { error: 'R2 belum dikonfigurasi. Binding BACKUP_BUCKET wajib di wrangler.toml / dashboard.' },
      503,
    );
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Supabase wajib untuk menyimpan metadata backup.' }, 503);
  }

  // Gate: butuh langganan cloud aktif (atau dev mock tanpa entitlements)
  try {
    const form = await c.req.formData();
    const file = form.get('file');
    const storeIdRaw = form.get('storeId');
    const storeId =
      typeof storeIdRaw === 'string' && storeIdRaw.trim() ? storeIdRaw.trim() : null;
    if (storeId && !UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);

    // Kepemilikan toko bila upload per toko (kuota & metadata ikut toko itu).
    if (storeId) {
      const own = await sbGet<{ id: string }[]>(
        c.env,
        `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id`,
      );
      if (!own[0]) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    }

    // Model per-toko: entitlement diambil dari toko tujuan; tanpa storeId (legacy) pakai akun.
    type Ent = { storage_limit_mb: number; has_sync: boolean };
    const entQuery = storeId
      ? `store_entitlements?store_id=eq.${storeId}&select=storage_limit_mb,has_sync`
      : `user_entitlements?user_id=eq.${userId}&select=storage_limit_mb,has_sync`;
    const ents = await sbGet<Ent[]>(c.env, entQuery);
    const ent = ents[0];
    const limitMb = ent?.storage_limit_mb ?? 0;
    const hasCloud = ent?.has_sync || limitMb > 0;
    if (!hasCloud && (c.env.PAYMENT_PROVIDER || 'mock') !== 'mock') {
      return c.json({ error: 'Langganan Profitku Cloud diperlukan untuk backup cloud.' }, 403);
    }

    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return c.json({ error: 'File backup wajib (field: file)' }, 400);
    }

    const blob = file as Blob & { name?: string };
    const fileName =
      (typeof blob.name === 'string' && blob.name) ||
      (typeof form.get('fileName') === 'string' ? String(form.get('fileName')) : 'backup.json');
    const buf = await blob.arrayBuffer();
    const fileSize = buf.byteLength;
    if (fileSize <= 0) return c.json({ error: 'File kosong' }, 400);
    if (fileSize > 50 * 1024 * 1024) {
      return c.json({ error: 'Ukuran backup maksimal 50 MB' }, 400);
    }

    // CLOUD-011: reservation atomik per scope menutup race dua upload
    // concurrent sebelum object R2 ditulis.
    const id = crypto.randomUUID();
    const quotaLimitMb = limitMb > 0 ? limitMb : 1024;
    const reservation = await sbPost<boolean | boolean[]>(c.env, 'rpc/reserve_backup_quota', {
      p_reservation_id: id,
      p_user_id: String(userId),
      p_store_id: storeId,
      p_file_size: fileSize,
      p_limit_mb: quotaLimitMb,
    });
    const reserved = Array.isArray(reservation) ? reservation[0] === true : reservation === true;
    if (!reserved) {
      return c.json(
        { error: `Kuota backup penuh (${quotaLimitMb} MB). Hapus backup lama dulu.` },
        413,
      );
    }

    const key = fileKeyFor(String(userId), fileName, storeId);
    try {
      await putBackupObject(c.env, key, buf);
      const meta = await insertBackupMeta(c.env, {
        id,
        user_id: String(userId),
        store_id: storeId,
        file_name: fileName,
        file_key: key,
        file_size: fileSize,
      });

      await sbPatch(c.env, `backup_quota_reservations?id=eq.${id}`, {
        status: 'completed',
      }).catch(() => undefined);

      return c.json({
        backup: {
          id: meta.id,
          fileName: meta.file_name,
          fileSize: meta.file_size,
          createdAt: meta.created_at,
          updatedAt: meta.updated_at,
        },
      });
    } catch (metadataError) {
      // Avoid an unreachable R2 object when the metadata write fails.
      try {
        await deleteBackupObject(c.env, key);
      } catch (cleanupError) {
        console.error('[backup upload] orphan cleanup failed', cleanupError);
      }
      await sbDelete(c.env, `backup_quota_reservations?id=eq.${id}`).catch(() => undefined);
      throw metadataError;
    }
  } catch (err) {
    console.error('[backup upload]', err);
    const msg = err instanceof Error ? err.message : 'Upload gagal';
    return c.json({ error: msg }, 500);
  }
});

backupsRoutes.get('/backups/:id/download', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id') ?? '';
  const storeId = c.req.query('storeId') ?? '';
  if (storeId && !UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);

  try {
    const meta = await getBackupMeta(c.env, id, String(userId));
    if (!meta) return c.json({ error: 'Backup tidak ditemukan' }, 404);
    // CLOUD-007: backup hanya boleh direstore ke toko pemiliknya. Restore
    // lintas toko dalam akun yang sama ditolak (hindari menimpa DB yang salah).
    if (storeId) {
      if (meta.store_id !== storeId) {
        return c.json({ error: 'Backup ini bukan milik toko yang dipilih' }, 400);
      }
    } else if (meta.store_id) {
      return c.json({ error: 'storeId wajib untuk mengunduh backup toko' }, 400);
    }
    const obj = await getBackupObject(c.env, meta.file_key);
    if (!obj) return c.json({ error: 'File backup tidak ada di storage' }, 404);
    const text = await obj.text();
    try {
      const json = JSON.parse(text);
      return c.json(json);
    } catch {
      return new Response(text, {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('[backup download]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Download gagal' }, 500);
  }
});

backupsRoutes.delete('/backups/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id') ?? '';

  try {
    const meta = await getBackupMeta(c.env, id, String(userId));
    if (!meta) return c.json({ error: 'Backup tidak ditemukan' }, 404);
    await deleteBackupObject(c.env, meta.file_key);
    await deleteBackupMeta(c.env, id, String(userId));
    return c.json({ ok: true });
  } catch (err) {
    console.error('[backup delete]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Hapus gagal' }, 500);
  }
});

export default backupsRoutes;
