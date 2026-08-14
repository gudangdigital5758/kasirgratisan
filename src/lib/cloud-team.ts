/**
 * Login anggota tim cloud (C4 — keputusan 2026-08-13: PIN di-set owner via dashboard).
 * Verifikasi PIN dilakukan SERVER (api.profitku.my.id) — hash deterministik
 * lintas device. Session login cloud di-cache lokal 7 hari agar POS tetap bisa
 * dipakai offline setelah verifikasi pertama.
 */
import { BRAND } from './brand';
import type { PermissionKey } from './db';

function apiBase(): string {
  const fromEnv = String(import.meta.env.VITE_AUTH_API_URL || '').trim().replace(/\/$/, '');
  if (import.meta.env.DEV) return fromEnv || 'http://127.0.0.1:8787';
  if (fromEnv && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(fromEnv)) return fromEnv;
  return BRAND.apiOrigin;
}

export interface CloudMember {
  username: string;
  name: string | null;
  role: string;
}

/** Verifikasi username + PIN anggota tim cloud (rate-limited di server). */
export async function verifyCloudMember(storeId: string, username: string, pin: string): Promise<CloudMember> {
  const res = await fetch(`${apiBase()}/api/stores/${storeId}/team/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return (data as { member: CloudMember }).member;
}

// === Session cache (offline login setelah verifikasi pertama) ===

const CLOUD_SESSION_KEY = 'profitku_cloud_member_v1';
const CLOUD_SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

export interface CloudMemberSession extends CloudMember {
  storeId: string;
  exp: number;
}

export function saveCloudMemberSession(storeId: string, m: CloudMember): void {
  try {
    const s: CloudMemberSession = { ...m, storeId, exp: Date.now() + CLOUD_SESSION_MS };
    localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(s));
  } catch {
    /* localStorage penuh/diblokir — user login ulang lain kali */
  }
}

export function loadCloudMemberSession(storeId: string): CloudMemberSession | null {
  try {
    const raw = localStorage.getItem(CLOUD_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CloudMemberSession;
    if (!s?.email || s.storeId !== storeId || s.exp < Date.now()) {
      localStorage.removeItem(CLOUD_SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearCloudMemberSession(): void {
  try {
    localStorage.removeItem(CLOUD_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// === Peta role cloud → permission POS (konservatif) ===

export const CLOUD_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [
    'create_transaction',
    'delete_transaction',
    'manage_products',
    'manage_categories_payments',
    'manage_stock_inout',
    'manage_supplier',
    'manage_customers',
    'view_reports',
    'manage_backup',
    'manage_store_settings',
    'manage_expenses',
    'view_expenses',
  ],
  kasir: ['create_transaction'],
  salesman: ['create_transaction', 'manage_customers'],
  kepala_gudang: ['manage_products', 'manage_stock_inout', 'manage_supplier', 'view_reports'],
  karyawan: ['create_transaction'],
};

export function permissionsForCloudRole(role: string): PermissionKey[] {
  return CLOUD_ROLE_PERMISSIONS[role] ?? ['create_transaction'];
}
