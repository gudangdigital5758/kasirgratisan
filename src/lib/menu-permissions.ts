/**
 * Pemetaan Menu ↔ Permission (ROLES-PERMISSIONS M1).
 *
 * Digunakan oleh navigasi (BottomNav) dan kelak role manager untuk "menu on/off":
 * menu disembunyikan saat role user tidak memiliki permission terkait.
 * Halaman tetap di-gate di dalam via LockedPage — pemetaan ini hanya mengontrol
 * visibilitas menu di navigasi.
 */

import type { PermissionKey } from '@/lib/db';

/**
 * Kelompok permission untuk UI role manager — toggle dikelompokkan per area
 * (ROLES-PERMISSIONS M2).
 */
export const PERMISSION_GROUPS: { labelKey: string; permissions: PermissionKey[] }[] = [
  { labelKey: 'settings:roles.groups.cashier', permissions: ['create_transaction', 'delete_transaction'] },
  {
    labelKey: 'settings:roles.groups.productStock',
    permissions: ['manage_products', 'manage_stock_inout', 'manage_categories_payments'],
  },
  { labelKey: 'settings:roles.groups.reports', permissions: ['view_reports'] },
  { labelKey: 'settings:roles.groups.customer', permissions: ['manage_customers', 'manage_supplier'] },
  { labelKey: 'settings:roles.groups.expenses', permissions: ['view_expenses', 'manage_expenses'] },
  { labelKey: 'settings:roles.groups.settings', permissions: ['manage_backup', 'manage_store_settings'] },
];

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
