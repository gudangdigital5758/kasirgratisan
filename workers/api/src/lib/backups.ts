import type { Env } from '../env';
import { sbGet, sbPost, sbDelete, SupabaseError } from './supabase';

export interface BackupMeta {
  id: string;
  user_id: string;
  store_id: string | null;
  file_name: string;
  file_key: string;
  file_size: number;
  created_at: string;
  updated_at: string;
}

export function r2Configured(env: Env): boolean {
  return Boolean(env.BACKUP_BUCKET);
}

export function fileKeyFor(userId: string, fileName: string, storeId?: string | null): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const scope = storeId || 'account';
  return `backups/${userId}/${scope}/${crypto.randomUUID()}-${safe}`;
}

export async function putBackupObject(
  env: Env,
  key: string,
  body: ArrayBuffer | string,
  contentType = 'application/json',
): Promise<void> {
  if (!env.BACKUP_BUCKET) throw new Error('BACKUP_BUCKET (R2) belum dikonfigurasi');
  await env.BACKUP_BUCKET.put(key, body, {
    httpMetadata: { contentType },
  });
}

export async function getBackupObject(env: Env, key: string): Promise<R2ObjectBody | null> {
  if (!env.BACKUP_BUCKET) throw new Error('BACKUP_BUCKET (R2) belum dikonfigurasi');
  return env.BACKUP_BUCKET.get(key);
}

export async function deleteBackupObject(env: Env, key: string): Promise<void> {
  if (!env.BACKUP_BUCKET) return;
  await env.BACKUP_BUCKET.delete(key);
}

export async function listBackupMeta(env: Env, userId: string, limit = 50, storeId?: string): Promise<BackupMeta[]> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const storeFilter = storeId ? `&store_id=eq.${storeId}` : '';
  return sbGet<BackupMeta[]>(
    env,
    `backups?user_id=eq.${userId}${storeFilter}&order=created_at.desc&limit=${limit}&select=*`,
  );
}

export async function getBackupMeta(env: Env, id: string, userId: string): Promise<BackupMeta | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const rows = await sbGet<BackupMeta[]>(
    env,
    `backups?id=eq.${id}&user_id=eq.${userId}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

export async function insertBackupMeta(
  env: Env,
  row: {
    id: string;
    user_id: string;
    store_id?: string | null;
    file_name: string;
    file_key: string;
    file_size: number;
  },
): Promise<BackupMeta> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SupabaseError('Supabase wajib untuk metadata backup', 500, null);
  }
  const rows = await sbPost<BackupMeta[]>(env, 'backups', row);
  return rows[0];
}

export async function deleteBackupMeta(env: Env, id: string, userId: string): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  await sbDelete(env, `backups?id=eq.${id}&user_id=eq.${userId}`);
}

/** Total bytes backup user (untuk cek kuota). Bila storeId diberikan, dihitung per toko. */
export async function sumBackupBytes(env: Env, userId: string, storeId?: string): Promise<number> {
  const list = await listBackupMeta(env, userId, 500, storeId);
  return list.reduce((s, b) => s + (Number(b.file_size) || 0), 0);
}

/**
 * Cleanup backup files older than retention days.
 * Dipanggil via cron job daily untuk hapus backup expired.
 * 
 * @param env Worker environment
 * @param retentionDays Retention window (default: 30 hari)
 * @returns Number of backups deleted
 */
export async function cleanupExpiredBackups(env: Env, retentionDays = 30): Promise<{
  deleted: number;
  errors: number;
  cutoffDate: string;
}> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { deleted: 0, errors: 0, cutoffDate: '' };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();

  let deleted = 0;
  let errors = 0;

  try {
    // Query backups older than retention window
    const expired = await sbGet<BackupMeta[]>(
      env,
      `backups?created_at=lt.${cutoffIso}&select=*&limit=1000`,
    );

    console.log(`[cleanup] Found ${expired.length} expired backups (older than ${retentionDays} days)`);

    for (const backup of expired) {
      try {
        // Delete from R2
        await deleteBackupObject(env, backup.file_key);
        // Delete metadata from Supabase
        await deleteBackupMeta(env, backup.id, backup.user_id);
        deleted++;
      } catch (err) {
        console.error(`[cleanup] Failed to delete backup ${backup.id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('[cleanup] Query failed:', err);
    errors++;
  }

  return { deleted, errors, cutoffDate: cutoffIso };
}

/** Bersihkan reservation quota yang sudah expired/selesai agar metadata tidak tumbuh tanpa batas. */
export async function cleanupQuotaReservations(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const now = encodeURIComponent(new Date().toISOString());
  const completedCutoff = new Date();
  completedCutoff.setDate(completedCutoff.getDate() - 1);
  const cutoff = encodeURIComponent(completedCutoff.toISOString());
  await Promise.all([
    sbDelete(env, `backup_quota_reservations?status=eq.pending&expires_at=lt.${now}`),
    sbDelete(env, `backup_quota_reservations?status=in.(completed,released)&created_at=lt.${cutoff}`),
  ]);
}
