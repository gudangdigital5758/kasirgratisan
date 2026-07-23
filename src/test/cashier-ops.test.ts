import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  applyStockSoldDelta,
  saveOpenBillAtomic,
  cancelOpenBillAtomic,
  checkoutAtomic,
  CashierOpsError,
  type CartLine,
} from '@/lib/cashier-ops';

async function seedProduct(overrides: Partial<Parameters<typeof db.products.add>[0]> = {}) {
  const id = await db.products.add({
    name: 'Produk Test',
    sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: 1,
    price: 10000,
    hpp: 5000,
    stock: 10,
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

function line(product: Awaited<ReturnType<typeof seedProduct>>, qty: number): CartLine {
  return {
    product,
    qty,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    lineSubtotal: product.price * qty,
  };
}

describe('cashier-ops stock & atomic bills', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.debts.clear();
  });

  it('applyStockSoldDelta reads current DB stock', async () => {
    const p = await seedProduct({ stock: 5 });
    await applyStockSoldDelta(p.id!, 2);
    expect((await db.products.get(p.id!))!.stock).toBe(3);
    await applyStockSoldDelta(p.id!, -1);
    expect((await db.products.get(p.id!))!.stock).toBe(4);
  });

  it('rejects oversell', async () => {
    const p = await seedProduct({ stock: 2 });
    await expect(applyStockSoldDelta(p.id!, 3)).rejects.toBeInstanceOf(CashierOpsError);
    expect((await db.products.get(p.id!))!.stock).toBe(2);
  });

  it('saveOpenBillAtomic reserves stock atomically', async () => {
    const p = await seedProduct({ stock: 10 });
    const { transaction, items } = await saveOpenBillAtomic({
      lines: [line(p, 3)],
      subtotal: 30000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 30000,
      profit: 0,
    });
    expect(transaction.status).toBe('open');
    expect(items).toHaveLength(1);
    expect((await db.products.get(p.id!))!.stock).toBe(7);
  });

  it('cancelOpenBillAtomic restores stock', async () => {
    const p = await seedProduct({ stock: 10 });
    const { transaction } = await saveOpenBillAtomic({
      lines: [line(p, 4)],
      subtotal: 40000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 40000,
      profit: 0,
    });
    await cancelOpenBillAtomic(transaction);
    expect((await db.products.get(p.id!))!.stock).toBe(10);
    expect(await db.transactions.count()).toBe(0);
  });

  it('checkoutAtomic new sale deducts stock once', async () => {
    const p = await seedProduct({ stock: 10 });
    const { transaction, items } = await checkoutAtomic({
      lines: [line(p, 2)],
      subtotal: 20000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 20000,
      profit: 10000,
      paymentMethodId: 1,
      paymentAmount: 20000,
      change: 0,
      debtAmount: 0,
    });
    expect(transaction.status).toBe('completed');
    expect(items).toHaveLength(1);
    expect((await db.products.get(p.id!))!.stock).toBe(8);
  });

  it('checkout from open bill only applies qty delta', async () => {
    const p = await seedProduct({ stock: 10 });
    const open = await saveOpenBillAtomic({
      lines: [line(p, 3)],
      subtotal: 30000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 30000,
      profit: 0,
    });
    expect((await db.products.get(p.id!))!.stock).toBe(7);

    const fresh = (await db.products.get(p.id!))!;
    await checkoutAtomic({
      editingTxId: open.transaction.id,
      lines: [line(fresh, 5)],
      subtotal: 50000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 50000,
      profit: 25000,
      paymentMethodId: 1,
      paymentAmount: 50000,
      change: 0,
      debtAmount: 0,
    });
    // reserved 3 then +2 more → stock 5
    expect((await db.products.get(p.id!))!.stock).toBe(5);
  });
});
