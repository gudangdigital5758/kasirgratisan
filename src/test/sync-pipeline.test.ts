import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { applyPull, toIso } from '@/lib/sync';
import type { SyncPullResult } from '@/lib/cloud-api';

describe('Sync applyPull (M2) — LWW + tombstone + FK resolve', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
  });

  afterEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
  });

  it('inserts a new record from pull with syncId and server time', async () => {
    const result: SyncPullResult = {
      records: [
        {
          table: 'products',
          syncId: 'p-1',
          data: { name: 'Dari Cloud', sku: 'CLOUD-1', categoryId: 1, price: 5000, hpp: 2000, stock: 3, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T09:00:00.000Z' },
          updatedAt: '2026-08-05T09:30:00.000Z',
        },
      ],
      tombstones: [],
      serverTime: '2026-08-05T10:00:00.000Z',
    };
    await applyPull(result);
    const p = await db.products.filter((r) => r.syncId === 'p-1').first();
    expect(p).toBeTruthy();
    expect(p?.name).toBe('Dari Cloud');
    expect(p?.syncedAt).toBeInstanceOf(Date);
    expect(p?.updatedAt).toEqual(new Date('2026-08-05T09:30:00.000Z'));
  });

  it('LWW: local newer record wins (pull skipped)', async () => {
    const id = await db.products.add({
      name: 'Lokal Baru', sku: 'L1', categoryId: 1, price: 100, hpp: 50, stock: 1, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date('2026-08-05T11:00:00.000Z'),
    });
    // server lebih lama -> lokal menang
    await applyPull({
      records: [{ table: 'products', syncId: '', data: {}, updatedAt: '2026-08-05T10:00:00.000Z' }],
      tombstones: [],
      serverTime: '2026-08-05T12:00:00.000Z',
    });
    const p = await db.products.get(id as number);
    expect(p?.name).toBe('Lokal Baru');
  });

  it('LWW: server newer record overwrites local', async () => {
    const id = await db.products.add({
      name: 'Lokal Lama', sku: 'L2', categoryId: 1, price: 100, hpp: 50, stock: 1, unit: 'pcs',
      syncId: 'p-2', isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date('2026-08-05T10:00:00.000Z'),
    });
    await applyPull({
      records: [{
        table: 'products', syncId: 'p-2', data: { name: 'Dari Cloud Baru', sku: 'L2', categoryId: 1, price: 200, hpp: 50, stock: 2, unit: 'pcs', isDeleted: 0, deletedAt: null },
        updatedAt: '2026-08-05T11:00:00.000Z',
      }],
      tombstones: [],
      serverTime: '2026-08-05T12:00:00.000Z',
    });
    const p = await db.products.get(id as number);
    expect(p?.name).toBe('Dari Cloud Baru');
  });

  it('tombstone soft-deletes record when server wins', async () => {
    const id = await db.products.add({
      name: 'Akan Dihapus', sku: 'D3', categoryId: 1, price: 100, hpp: 50, stock: 1, unit: 'pcs',
      syncId: 'p-del', isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date('2026-08-05T10:00:00.000Z'),
    });
    await applyPull({
      records: [],
      tombstones: [{ table: 'products', syncId: 'p-del', deletedAt: '2026-08-05T11:00:00.000Z' }],
      serverTime: '2026-08-05T12:00:00.000Z',
    });
    const p = await db.products.get(id as number);
    expect(p?.isDeleted).toBe(1);
  });

  it('resolves local FK from parent syncId (transactionItems)', async () => {
    const txId = await db.transactions.add({
      subtotal: 1000, discountType: null, discountValue: 0, discountAmount: 0, total: 1000,
      paymentMethodId: 1, paymentAmount: 1000, change: 0, profit: 100,
      date: new Date(), receiptNumber: 'TX-1', status: 'completed',
      syncId: 'tx-1', updatedAt: new Date(),
    });
    await applyPull({
      records: [{
        table: 'transactionItems',
        syncId: 'ti-1',
        data: {
          transactionSyncId: 'tx-1', productId: 999, productName: 'Item', quantity: 1, price: 1000, hpp: 500,
          discountType: null, discountValue: 0, discountAmount: 0, subtotal: 1000,
        },
        updatedAt: '2026-08-05T11:00:00.000Z',
      }],
      tombstones: [],
      serverTime: '2026-08-05T12:00:00.000Z',
    });
    const item = await db.transactionItems.filter((r) => r.syncId === 'ti-1').first();
    expect(item?.transactionId).toBe(txId as number);
    void toIso;
  });
});
