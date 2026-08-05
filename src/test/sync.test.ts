import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';

describe('Real-time Sync Columns and Hooks', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.paymentMethods.clear();
    await db.deletedRecords.clear();
  });

  afterEach(async () => {
    await db.products.clear();
    await db.paymentMethods.clear();
    await db.deletedRecords.clear();
  });

  it('should automatically set updatedAt and syncedAt on creating a product', async () => {
    const id = await db.products.add({
      name: 'Test Hook Product',
      sku: 'TESTHOOK001',
      categoryId: 1,
      price: 10000,
      hpp: 5000,
      stock: 10,
      unit: 'pcs',
      isDeleted: 0,
      deletedAt: null,
      createdAt: new Date(),
    });

    const product = await db.products.get(id);
    expect(product).toBeDefined();
    expect(product?.updatedAt).toBeInstanceOf(Date);
    expect(product?.syncedAt).toBeNull();
  });

  it('should automatically update updatedAt and reset syncedAt on updating a product', async () => {
    const id = await db.products.add({
      name: 'Test Hook Product 2',
      sku: 'TESTHOOK002',
      categoryId: 1,
      price: 10000,
      hpp: 5000,
      stock: 10,
      unit: 'pcs',
      isDeleted: 0,
      deletedAt: null,
      createdAt: new Date(),
    });

    const initialProduct = await db.products.get(id);
    const initialUpdatedAt = initialProduct?.updatedAt;

    // Simulate successful sync
    await db.products.update(id, { syncedAt: new Date() });
    const syncedProduct = await db.products.get(id);
    expect(syncedProduct?.syncedAt).toBeInstanceOf(Date);
    expect(syncedProduct?.updatedAt.getTime()).toBe(initialUpdatedAt?.getTime());

    // User updates price
    await db.products.update(id, { price: 12000 });
    const updatedProduct = await db.products.get(id);
    expect(updatedProduct?.syncedAt).toBeNull();
    expect(updatedProduct?.updatedAt.getTime()).toBeGreaterThan(initialUpdatedAt?.getTime() || 0);
  });

  it('should record tombstone in deletedRecords when hard deleting a payment method', async () => {
    const id = await db.paymentMethods.add({
      name: 'Test Payment Method',
      category: 'tunai',
      isDefault: false,
      createdAt: new Date(),
    });

    // Verify it exists
    const pm = await db.paymentMethods.get(id);
    expect(pm).toBeDefined();

    // Delete it
    await db.paymentMethods.delete(id);

    // Wait for the asynchronous tombstone recording (since it uses setTimeout)
    await new Promise(resolve => setTimeout(resolve, 50));

    const tombstones = await db.deletedRecords.toArray();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].tableName).toBe('paymentMethods');
    expect(tombstones[0].recordId).toBe(id);
    expect(tombstones[0].syncedAt).toBeNull();
  });
});
