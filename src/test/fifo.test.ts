import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  addStockLot,
  consumeFifo,
  lotsForProduct,
  deleteTransactionAtomic,
  InventoryError,
} from '@/lib/inventory';
import {
  saveOpenBillAtomic,
  cancelOpenBillAtomic,
  checkoutAtomic,
  type CartLine,
} from '@/lib/cashier-ops';
import type { Product } from '@/lib/db';

async function seedProduct(overrides: Partial<Parameters<typeof db.products.add>[0]> = {}) {
  const id = await db.products.add({
    name: 'Produk FIFO',
    sku: `FIFO-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: 1,
    price: 15000,
    hpp: 0,
    stock: 0,
    unit: 'pcs',
    trackStock: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: 0,
    deletedAt: null,
    ...overrides,
  });
  return (await db.products.get(id))!;
}

/** Seed batch dengan tanggal terkontrol (termuda = paling akhir). */
async function seedLots(productId: number, entries: Array<[qty: number, cost: number, minutesAgo: number]>) {
  const now = Date.now();
  for (const [qty, cost, minutesAgo] of entries) {
    await addStockLot({
      productId,
      quantity: qty,
      unitCost: cost,
      date: new Date(now - minutesAgo * 60_000),
      source: 'stock_in',
    });
  }
  // Samakan produk dengan total batch.
  const lots = await lotsForProduct(productId);
  const stock = lots.reduce((s, l) => s + l.quantityRemaining, 0);
  await db.products.update(productId, { stock, hpp: lots[0]?.unitCost ?? 0 });
}

function line(product: Product, qty: number): CartLine {
  return {
    product,
    qty,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    lineSubtotal: product.price * qty,
  };
}

describe('FIFO stock lots', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.stockLots.clear();
    await db.stockLotAllocations.clear();
    await db.debts.clear();
    await db.categories.clear();
    await db.categories.add({ id: 1, name: 'Kategori', color: '#000', icon: '', isDeleted: 0, deletedAt: null, createdAt: new Date() });
  });

  it('konsumsi memakai batch tertua dulu (100×10rb + 50×11rb, jual 120 → sisa 30×11rb)', async () => {
    const p = await seedProduct();
    // Batch 1 (lebih tua): 100 × 10.000; Batch 2: 50 × 11.000.
    await seedLots(p.id!, [
      [100, 10000, 120],
      [50, 11000, 60],
    ]);

    const { transaction, items } = await checkoutAtomic({
      lines: [line(p, 120)],
      subtotal: 120 * p.price,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 120 * p.price,
      profit: 0,
      paymentMethodId: 1,
      paymentAmount: 120 * p.price,
      change: 0,
      debtAmount: 0,
    });

    // HPP transaksi = 100×10.000 + 20×11.000 = 1.220.000 (bukan rata-rata 10.333).
    expect(items[0].costAmount).toBe(1_220_000);
    expect(transaction.profit).toBe(120 * p.price - 1_220_000);

    // Sisa batch: batch 1 habis, batch 2 tersisa 30 × 11.000.
    const lots = await lotsForProduct(p.id!);
    expect(lots).toHaveLength(1);
    expect(lots[0].quantityRemaining).toBe(30);
    expect(lots[0].unitCost).toBe(11000);

    const fresh = (await db.products.get(p.id!))!;
    expect(fresh.stock).toBe(30);
    expect(fresh.hpp).toBe(11000);

    // Alokasi batch tercatat per item transaksi.
    const allocations = await db.stockLotAllocations.toArray();
    expect(allocations).toHaveLength(2);
    expect(allocations[0].quantity).toBe(100);
    expect(allocations[0].costAmount).toBe(1_000_000);
    expect(allocations[1].quantity).toBe(20);
    expect(allocations[1].costAmount).toBe(220_000);
  });

  it('batal open bill mengembalikan stok ke batch asal', async () => {
    const p = await seedProduct();
    await seedLots(p.id!, [
      [10, 10000, 120],
      [10, 11000, 60],
    ]);

    const open = await saveOpenBillAtomic({
      lines: [line(p, 15)],
      subtotal: 15 * p.price,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 15 * p.price,
      profit: 0,
    });
    expect((await db.products.get(p.id!))!.stock).toBe(5);

    await cancelOpenBillAtomic(open.transaction);

    const lots = await lotsForProduct(p.id!);
    expect(lots).toHaveLength(2);
    expect(lots[0].quantityRemaining).toBe(10);
    expect(lots[1].quantityRemaining).toBe(10);
    expect((await db.products.get(p.id!))!.stock).toBe(20);
    expect(await db.transactions.count()).toBe(0);
  });

  it('hapus transaksi dengan restore mengembalikan stok ke batch asal', async () => {
    const p = await seedProduct();
    await seedLots(p.id!, [
      [10, 10000, 120],
    ]);

    const { transaction } = await checkoutAtomic({
      lines: [line(p, 4)],
      subtotal: 4 * p.price,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 4 * p.price,
      profit: 0,
      paymentMethodId: 1,
      paymentAmount: 4 * p.price,
      change: 0,
      debtAmount: 0,
    });

    await deleteTransactionAtomic(transaction.id!, true);

    const lots = await lotsForProduct(p.id!);
    expect(lots).toHaveLength(1);
    expect(lots[0].quantityRemaining).toBe(10);
    expect((await db.products.get(p.id!))!.stock).toBe(10);
    expect(await db.transactionItems.count()).toBe(0);
    expect(await db.stockLotAllocations.count()).toBe(0);
  });

  it('menolak oversell saat batch tidak cukup', async () => {
    const p = await seedProduct();
    await seedLots(p.id!, [[5, 10000, 60]]);

    await expect(consumeFifo(p, 6)).rejects.toBeInstanceOf(InventoryError);
    const lots = await lotsForProduct(p.id!);
    expect(lots[0].quantityRemaining).toBe(5);
  });
});
