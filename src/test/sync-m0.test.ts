import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { newSyncId } from '@/lib/sync-id';

describe('sync M0 — auto syncId', () => {
  beforeEach(async () => {
    await db.products.clear();
  });

  it('generates a unique syncId on create via setupSyncHooks', async () => {
    const id1 = await db.products.add({
      name: 'Produk A', sku: 'A1', categoryId: 1, price: 1000, hpp: 500, stock: 10, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    const id2 = await db.products.add({
      name: 'Produk B', sku: 'B1', categoryId: 1, price: 2000, hpp: 1000, stock: 5, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    const a = await db.products.get(id1 as number);
    const b = await db.products.get(id2 as number);
    expect(a?.syncId).toBeTruthy();
    expect(b?.syncId).toBeTruthy();
    expect(a?.syncId).not.toBe(b?.syncId);
  });

  it('preserves an explicitly provided syncId', async () => {
    const given = newSyncId();
    const id = await db.products.add({
      name: 'Produk C', sku: 'C1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null, syncId: given,
    });
    const p = await db.products.get(id as number);
    expect(p?.syncId).toBe(given);
  });

  it('newSyncId returns a non-empty string', () => {
    expect(typeof newSyncId()).toBe('string');
    expect(newSyncId().length).toBeGreaterThan(0);
  });
});
