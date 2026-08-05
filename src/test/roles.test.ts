import { beforeEach, describe, expect, it } from 'vitest';
import { db, seedDefaultRoles, ALL_PERMISSIONS } from '@/lib/db';
import { canAccessMenu, MENU_PERMISSION } from '@/lib/menu-permissions';
import { syncUsersToRole } from '@/lib/auth';
import type { PermissionKey } from '@/lib/db';

function canWith(perms: PermissionKey[]): (key: PermissionKey) => boolean {
  return (key) => perms.includes(key);
}

describe('menu-permissions — canAccessMenu', () => {
  it('unmapped route is always visible', () => {
    expect(canAccessMenu('/settings', canWith([]))).toBe(true);
    expect(canAccessMenu('/unknown', canWith([]))).toBe(true);
  });

  it('mapped route requires its permission', () => {
    expect(canAccessMenu('/products', canWith(['manage_products']))).toBe(true);
    expect(canAccessMenu('/products', canWith([]))).toBe(false);
    expect(canAccessMenu('/reports', canWith(['view_reports']))).toBe(true);
    expect(canAccessMenu('/cashier', canWith(['create_transaction']))).toBe(true);
  });

  it('MENU_PERMISSION covers bottom nav work routes', () => {
    for (const route of ['/', '/cashier', '/products', '/reports']) {
      expect(MENU_PERMISSION[route]).toBeDefined();
    }
  });
});

describe('seedDefaultRoles', () => {
  beforeEach(async () => {
    await db.roles.clear();
    await db.users.clear();
  });

  it('seeds Admin & Sales built-in roles and maps existing staff', async () => {
    // Staff lama tanpa roleId
    await db.users.add({
      username: 'kasir1',
      pinHash: 'x',
      name: 'Kasir 1',
      role: 'staff',
      permissions: ['create_transaction'],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    await seedDefaultRoles();

    const roles = await db.roles.toArray();
    expect(roles).toHaveLength(2);
    const sales = roles.find((r) => r.name === 'Sales')!;
    const admin = roles.find((r) => r.name === 'Admin')!;
    expect(sales.isBuiltIn).toBe(1);
    expect(sales.permissions).toEqual(['create_transaction']);
    expect(admin.isBuiltIn).toBe(1);
    expect([...admin.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());

    const staff = await db.users.where('username').equals('kasir1').first();
    expect(staff?.roleId).toBe(sales.id);
  });

  it('is idempotent and preserves existing roleId', async () => {
    await seedDefaultRoles();
    const sales = (await db.roles.toArray()).find((r) => r.name === 'Sales')!;

    await db.users.add({
      username: 'kasir2',
      pinHash: 'x',
      name: 'Kasir 2',
      role: 'staff',
      roleId: sales.id,
      permissions: ['create_transaction'],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    await seedDefaultRoles();
    const roles = await db.roles.toArray();
    expect(roles).toHaveLength(2);

    const staff = await db.users.where('username').equals('kasir2').first();
    expect(staff?.roleId).toBe(sales.id);
  });
});

describe('syncUsersToRole', () => {
  beforeEach(async () => {
    await db.roles.clear();
    await db.users.clear();
    await seedDefaultRoles();
  });

  it('applies role permissions to all users with that roleId', async () => {
    const sales = (await db.roles.toArray()).find((r) => r.name === 'Sales')!;
    await db.users.add({
      username: 'kasir3',
      pinHash: 'x',
      name: 'Kasir 3',
      role: 'staff',
      roleId: sales.id,
      permissions: ['create_transaction'],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    // Role diperluas jadi 2 permission
    const newPerms: PermissionKey[] = ['create_transaction', 'view_reports'];
    await syncUsersToRole({ id: sales.id, permissions: newPerms });

    const staff = await db.users.where('username').equals('kasir3').first();
    expect(staff?.permissions).toEqual(newPerms);
  });

  it('never touches owner users', async () => {
    await db.users.add({
      username: 'owner1',
      pinHash: 'x',
      name: 'Owner 1',
      role: 'owner',
      permissions: [],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });
    const admin = (await db.roles.toArray()).find((r) => r.name === 'Admin')!;
    await syncUsersToRole({ id: admin.id, permissions: ['view_reports'] });
    const owner = await db.users.where('username').equals('owner1').first();
    expect(owner?.permissions).toEqual([]);
  });
});
