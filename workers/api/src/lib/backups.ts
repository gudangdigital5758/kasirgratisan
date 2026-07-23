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

export function fileKeyFor(userId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `backups/${userId}/${crypto.randomUUID()}-${safe}`;
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

export async function listBackupMeta(env: Env, userId: string, limit = 50): Promise<BackupMeta[]> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  return sbGet<BackupMeta[]>(
    env,
    `backups?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&select=*`,
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

/** Total bytes backup user (untuk cek kuota). */
export async function sumBackupBytes(env: Env, userId: string): Promise<number> {
  const list = await listBackupMeta(env, userId, 500);
  return list.reduce((s, b) => s + (Number(b.file_size) || 0), 0);
}
