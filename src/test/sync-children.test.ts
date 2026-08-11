import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { collectPushPayload } from '@/lib/sync';

/**
 * CLOUD-003 / CLOUD-010: hook sync tabel child (transactionItems,
 * stockOpnameItems, roles) + tombstone delete child + stripping credential.
 */
describe('Sync hooks tabel child (CLOUD-003/010/005)', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
    await db.roles.clear();
    await db.users.clear();
    await db.deletedRecords.clear();
  });

  afterEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
    await db.roles.clear();
    await db.users.clear();
    await db.deletedRecords.clear();
  });

  it('transactionItems baru mendapat syncId', async () => {
    const id = await db.transactionItems.add({
      transactionId: 1,
      productId: 1,
      productName: 'Nasi Goreng',
      quantity: 2,
      price: 15000,
      hpp: 8000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      subtotal: 30000,
    });
    const row = await db.transactionItems.get(id as number);
    expect(row?.syncId).toBeTruthy();
  });

  it('stockOpnameItems baru mendapat syncId', async () => {
    const opnameId = await db.stockOpnames.add({ date: new Date(), status: 'draft', notes: '' });
    const id = await db.stockOpnameItems.add({
      opnameId: opnameId as number,
      productId: 1,
      systemStock: 10,
      realStock: 8,
      difference: -2,
    });
    const row = await db.stockOpnameItems.get(id as number);
    expect(row?.syncId).toBeTruthy();
  });

  it('roles: create mendapat syncId, edit user (tanpa updatedAt manual) jadi dirty', async () => {
    const rid = await db.roles.add({
      name: 'Sales',
      permissions: ['create_transaction'],
      isBuiltIn: 1,
      isActive: 1,
      createdAt: new Date(),
    });
    const added = await db.roles.get(rid as number);
    expect(added?.syncId).toBeTruthy();
    expect(added?.syncedAt).toBeNull();

    // Simulasi sudah pernah sync
    await db.roles.update(rid as number, { syncedAt: new Date() });
    // Edit role layaknya RoleManager (hanya permissions, tanpa updatedAt manual)
    await db.roles.update(rid as number, { permissions: ['create_transaction', 'manage_products'] });
    const after = await db.roles.get(rid as number);
    expect(after?.syncedAt).toBeNull();
    expect(after?.updatedAt).toBeInstanceOf(Date);
  });

  it('delete transactionItems menghasilkan tombstone dengan recordSyncId', async () => {
    const id = await db.transactionItems.add({
      transactionId: 1,
      productId: 1,
      productName: 'Item',
      quantity: 1,
      price: 1000,
      hpp: 500,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      subtotal: 1000,
    });
    const before = await db.transactionItems.get(id as number);
    await db.transactionItems.delete(id as number);
    await new Promise((r) => setTimeout(r, 50));
    const tombstones = await db.deletedRecords
      .filter((r) => r.tableName === 'transactionItems')
      .toArray();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].recordSyncId).toBe(before?.syncId);
  });

  it('collectPushPayload tidak mengirim pinHash (users)', async () => {
    await db.users.add({
      username: 'kasir1',
      pinHash: 'sensitive-hash',
      name: 'Kasir Satu',
      role: 'staff',
      permissions: ['create_transaction'],
      isActive: 1,
      createdAt: new Date(),
      lastLoginAt: null,
    });
    const payload = await collectPushPayload();
    const users = payload.records.users ?? [];
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect((u.data as Record<string, unknown>).pinHash).toBeUndefined();
    }
  });
});
