import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { buildCloudBackupJsonString, restoreFromBackupData, BACKUP_VERSION } from '@/lib/backup';

describe('Cloud backup credential boundary', () => {
  beforeEach(async () => {
    await db.users.clear();
    await db.storeSettings.clear();
    await db.categories.clear();
    await db.products.clear();
  });

  afterEach(async () => {
    await db.users.clear();
    await db.storeSettings.clear();
    await db.categories.clear();
    await db.products.clear();
  });

  it('menghapus pinHash/deviceId dari JSON backup cloud', async () => {
    await db.storeSettings.add({
      storeName: 'Toko Cloud',
      address: '',
      phone: '',
      receiptFooter: '',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'device-local',
      multiUserEnabled: true,
    });
    await db.users.add({
      username: 'owner',
      pinHash: 'secret-hash',
      name: 'Owner',
      role: 'owner',
      permissions: [],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    const backup = JSON.parse(await buildCloudBackupJsonString()) as {
      cloudCredentialRedacted?: boolean;
      users?: Record<string, unknown>[];
      storeSettings?: Record<string, unknown>[];
    };

    expect(backup.cloudCredentialRedacted).toBe(true);
    expect(backup.users?.[0]?.pinHash).toBeUndefined();
    expect(backup.storeSettings?.[0]?.deviceId).toBeUndefined();
  });

  it('cloud restore mempertahankan user lokal dan deviceId lokal', async () => {
    await db.storeSettings.add({
      storeName: 'Toko Lama',
      address: '',
      phone: '',
      receiptFooter: '',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'device-target',
      multiUserEnabled: true,
    });
    await db.users.add({
      username: 'local-owner',
      pinHash: 'local-hash',
      name: 'Local Owner',
      role: 'owner',
      permissions: [],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    await restoreFromBackupData({
      version: BACKUP_VERSION,
      cloudCredentialRedacted: true,
      categories: [{ name: 'Cloud', color: '', icon: '', isDeleted: 0, deletedAt: null, createdAt: new Date() }],
      products: [{
        name: 'Produk Cloud', sku: 'CLOUD-1', categoryId: 1, price: 1000, hpp: 500, stock: 1,
        unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
      }],
      storeSettings: [{
        storeName: 'Toko Cloud', address: '', phone: '', receiptFooter: '', onboardingDone: true,
        lastBackupAt: null, multiUserEnabled: true,
      }],
      users: [{ username: 'remote-owner', name: 'Remote Owner', role: 'owner', permissions: [], isActive: 1 }],
    });

    const settings = await db.storeSettings.toCollection().first();
    const users = await db.users.toArray();
    expect(settings?.deviceId).toBe('device-target');
    expect(settings?.multiUserEnabled).toBe(true);
    expect(users.map((u) => u.username)).toEqual(['local-owner']);
  });
});
