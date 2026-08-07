/**
 * Helper baca platform_settings (key/value opsional, service role).
 * Dipakai untuk flag operasional: maintenance_mode, dunning_enabled, dll.
 */
import type { Env } from '../env';
import { sbGet } from './supabase';

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Baca satu key platform_settings dengan fallback. Safe terhadap key tak dikenal. */
export async function getPlatformSetting<T>(
  env: Env,
  key: string,
  fallback: T,
): Promise<T> {
  if (!KEY_RE.test(key)) return fallback;
  try {
    const rows = await sbGet<{ key: string; value: T }[]>(
      env,
      `platform_settings?key=eq.${key}&select=key,value&limit=1`,
    );
    const v = rows[0]?.value;
    if (v !== undefined && v !== null) return v;
  } catch (err) {
    console.warn(`[platform_settings:${key}]`, err);
  }
  return fallback;
}

/** Maintenance mode aktif? (default false). */
export async function isMaintenanceMode(env: Env): Promise<boolean> {
  return getPlatformSetting<boolean>(env, 'maintenance_mode', false);
}

/** Dunning (pengingat perpanjangan) aktif? (default true). */
export async function isDunningEnabled(env: Env): Promise<boolean> {
  return getPlatformSetting<boolean>(env, 'dunning_enabled', true);
}
