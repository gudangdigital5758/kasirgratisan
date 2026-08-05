/**
 * Pemetaan Menu ↔ Permission (ROLES-PERMISSIONS M1).
 *
 * Digunakan oleh navigasi (BottomNav) dan kelak role manager untuk "menu on/off":
 * menu disembunyikan saat role user tidak memiliki permission terkait.
 * Halaman tetap di-gate di dalam via LockedPage — pemetaan ini hanya mengontrol
 * visibilitas menu di navigasi.
 */

import type { PermissionKey } from '@/lib/db';

export const MENU_PERMISSION: Record<string, PermissionKey> = {
  '/': 'view_reports',
  '/cashier': 'create_transaction',
  '/products': 'manage_products',
  '/reports': 'view_reports',
  '/history': 'delete_transaction',
  '/stock-in': 'manage_stock_inout',
  '/stock-out': 'manage_stock_inout',
  '/stock-report': 'view_reports',
  '/supplier': 'manage_supplier',
  '/customers': 'manage_customers',
  '/debts': 'manage_customers',
  '/expenses': 'view_expenses',
  '/shifts': 'create_transaction',
};

/**
 * Cek visibilitas menu. Route yang tidak terpetakan (mis. hub `/settings`)
 * tidak disembunyikan — konten di dalamnya tetap di-gate per permission.
 */
export function canAccessMenu(route: string, can: (key: PermissionKey) => boolean): boolean {
  const perm = MENU_PERMISSION[route];
  if (!perm) return true;
  return can(perm);
}
