import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { bumpChangeCounter, getChangeCounter, onLocalChange } from '@/lib/change-counter';

describe('change-counter — listener auto-sync (onLocalChange)', () => {
  beforeEach(async () => {
    await db.products.clear();
  });

  afterEach(async () => {
    await db.products.clear();
  });

  it('bumpChangeCounter memanggil listener; unsubscribe menghentikan', () => {
    const fn = vi.fn();
    const unsub = onLocalChange(fn);

    bumpChangeCounter();
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    bumpChangeCounter();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('mutasi Dexie nyata (creating hook) memicu listener', async () => {
    const fn = vi.fn();
    const unsub = onLocalChange(fn);
    const before = getChangeCounter();

    await db.products.add({
      name: 'Pemicu Sync', sku: 'TRIG-1', categoryId: 1, price: 1000, hpp: 500,
      stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: new Date(),
    });

    expect(getChangeCounter()).toBeGreaterThan(before);
    expect(fn).toHaveBeenCalled();
    unsub();
  });
});
