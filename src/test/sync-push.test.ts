import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { pushSyncData } from '@/lib/sync';

describe('Incremental Data Sync PUSH', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();

    // Setup default store settings
    await db.storeSettings.add({
      storeName: 'Test Sync Store',
      address: '',
      phone: '',
      receiptFooter: '',
      printLogo: false,
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device-id',
      cloudStoreId: 'test-cloud-store-id',
    });
  });

  afterEach(async () => {
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();
  });

  it('returns the disabled-sync response without exposing a push API', async () => {
    await expect(pushSyncData('test-cloud-store-id')).resolves.toEqual({
      success: false,
      message: 'Sinkronisasi lintas perangkat belum tersedia. Gunakan backup cloud untuk pemulihan data.',
    });
  });

  it('keeps dirty records unsynced while cloud push is disabled', async () => {
    const categoryId = await db.categories.add({
      name: 'Sync Category',
      color: '#FF0000',
      icon: '📁',
      createdAt: new Date(),
      isDeleted: 0,
      deletedAt: null,
    });

    const productId = await db.products.add({
      name: 'Sync Product',
      sku: 'SYNCP001',
      categoryId,
      price: 15000,
      hpp: 9000,
      stock: 20,
      unit: 'pcs',
      isDeleted: 0,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const transactionId = await db.transactions.add({
      subtotal: 30000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 30000,
      paymentMethodId: 1,
      paymentAmount: 50000,
      change: 20000,
      profit: 10000,
      date: new Date(),
      receiptNumber: 'TX-TEST-001',
      status: 'completed',
    });

    await expect(pushSyncData('test-cloud-store-id')).resolves.toEqual({
      success: false,
      message: 'Sinkronisasi lintas perangkat belum tersedia. Gunakan backup cloud untuk pemulihan data.',
    });
    await expect(db.categories.get(categoryId)).resolves.toMatchObject({ syncedAt: null });
    await expect(db.products.get(productId)).resolves.toMatchObject({ syncedAt: null });
    await expect(db.transactions.get(transactionId)).resolves.toMatchObject({ syncedAt: null });
  });
});
