/**
 * Operasi domain kasir: open bill, checkout, batal — atomik via Dexie transaction.
 * Stok selalu dihitung dari nilai terkini di DB (bukan stok di memori cart).
 */

import {
  db,
  isStockManaged,
  type Product,
  type Transaction,
  type TransactionItemRecord,
  type Debt,
} from '@/lib/db';

export class CashierOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashierOpsError';
  }
}

export interface CartLine {
  product: Product;
  qty: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  lineSubtotal: number;
  notes?: string;
}

export interface BillTotals {
  subtotal: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  total: number;
  profit: number;
}

export interface CustomerFields {
  customerId?: number;
  customerName?: string;
  tableNumber?: string;
  remarks?: string;
}

export interface CheckoutPayment {
  paymentMethodId: number;
  paymentAmount: number;
  change: number;
  debtAmount: number;
}

function tables() {
  return [db.transactions, db.transactionItems, db.products, db.debts] as const;
}

/** deltaSold > 0 mengurangi stok; < 0 mengembalikan stok. */
export async function applyStockSoldDelta(productId: number, deltaSold: number): Promise<void> {
  if (deltaSold === 0) return;
  const product = await db.products.get(productId);
  if (!product || !isStockManaged(product)) return;

  const next = product.stock - deltaSold;
  if (next < 0) {
    throw new CashierOpsError(
      `Stok tidak cukup untuk "${product.name}" (tersedia ${product.stock}, perubahan ${deltaSold}).`,
    );
  }
  await db.products.update(productId, { stock: next, updatedAt: new Date() });
}

async function replaceItems(
  transactionId: number,
  lines: CartLine[],
): Promise<TransactionItemRecord[]> {
  await db.transactionItems.where('transactionId').equals(transactionId).delete();
  const itemRecords: TransactionItemRecord[] = lines.map((c) => ({
    transactionId,
    productId: c.product.id!,
    productName: c.product.name,
    quantity: c.qty,
    price: c.product.price,
    hpp: c.product.hpp,
    discountType: c.discountType,
    discountValue: c.discountValue,
    discountAmount: c.discountAmount,
    subtotal: c.lineSubtotal,
    notes: c.notes,
  }));
  if (itemRecords.length) await db.transactionItems.bulkAdd(itemRecords);
  return itemRecords;
}

/** Sesuaikan stok dari open bill lama → cart baru (delta per productId). */
async function applyOpenBillStockDeltas(
  oldItems: TransactionItemRecord[],
  lines: CartLine[],
): Promise<void> {
  const oldByProduct = new Map<number, number>();
  for (const oi of oldItems) {
    oldByProduct.set(oi.productId, (oldByProduct.get(oi.productId) ?? 0) + oi.quantity);
  }
  const newByProduct = new Map<number, { qty: number; managed: boolean }>();
  for (const line of lines) {
    const id = line.product.id!;
    const prev = newByProduct.get(id);
    newByProduct.set(id, {
      qty: (prev?.qty ?? 0) + line.qty,
      managed: isStockManaged(line.product),
    });
  }

  const allIds = new Set([...oldByProduct.keys(), ...newByProduct.keys()]);
  for (const productId of allIds) {
    const oldQty = oldByProduct.get(productId) ?? 0;
    const neu = newByProduct.get(productId);
    const newQty = neu?.qty ?? 0;
    // Jika produk di cart menandai managed; jika hanya di old bill, cek DB
    let managed = neu?.managed;
    if (managed === undefined) {
      const p = await db.products.get(productId);
      managed = p ? isStockManaged(p) : false;
    }
    if (!managed) continue;
    const deltaSold = newQty - oldQty; // positive = more reserved
    await applyStockSoldDelta(productId, deltaSold);
  }
}

export function makeReceiptNumber(now = Date.now()): string {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `TX${now}${rand}`;
}

export interface SaveOpenBillInput extends BillTotals, CustomerFields {
  lines: CartLine[];
  editingTxId?: number | null;
  createdBy?: number;
}

export interface SaveOpenBillResult {
  transaction: Transaction;
  items: TransactionItemRecord[];
}

export async function saveOpenBillAtomic(input: SaveOpenBillInput): Promise<SaveOpenBillResult> {
  if (input.lines.length === 0) throw new CashierOpsError('Keranjang kosong');

  const now = new Date();

  return db.transaction('rw', ...tables(), async () => {
    if (input.editingTxId) {
      const oldItems = await db.transactionItems
        .where('transactionId')
        .equals(input.editingTxId)
        .toArray();

      await db.transactions.update(input.editingTxId, {
        subtotal: input.subtotal,
        discountType: input.discountType,
        discountValue: input.discountValue,
        discountAmount: input.discountAmount,
        total: input.total,
        customerId: input.customerId,
        customerName: input.customerName,
        tableNumber: input.tableNumber,
        remarks: input.remarks,
        date: now,
      });

      const items = await replaceItems(input.editingTxId, input.lines);
      await applyOpenBillStockDeltas(oldItems, input.lines);

      const transaction = await db.transactions.get(input.editingTxId);
      if (!transaction) throw new CashierOpsError('Transaksi open bill tidak ditemukan');
      return { transaction, items };
    }

    const receiptNumber = makeReceiptNumber();
    const txData: Transaction = {
      subtotal: input.subtotal,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discountAmount: input.discountAmount,
      total: input.total,
      paymentMethodId: 0,
      paymentAmount: 0,
      change: 0,
      profit: 0,
      date: now,
      receiptNumber,
      status: 'open',
      customerId: input.customerId,
      customerName: input.customerName,
      tableNumber: input.tableNumber,
      remarks: input.remarks,
      openedAt: now,
      createdBy: input.createdBy,
    };

    const txId = (await db.transactions.add(txData)) as number;
    const items = await replaceItems(txId, input.lines);
    await applyOpenBillStockDeltas([], input.lines);

    return { transaction: { ...txData, id: txId }, items };
  });
}

export async function cancelOpenBillAtomic(tx: Transaction): Promise<void> {
  if (!tx.id) throw new CashierOpsError('ID transaksi tidak valid');
  const txId = tx.id;

  await db.transaction('rw', ...tables(), async () => {
    const items = await db.transactionItems.where('transactionId').equals(txId).toArray();
    for (const item of items) {
      await applyStockSoldDelta(item.productId, -item.quantity);
    }
    await db.transactionItems.where('transactionId').equals(txId).delete();
    await db.transactions.delete(txId);
  });
}

export interface CheckoutInput extends BillTotals, CustomerFields, CheckoutPayment {
  lines: CartLine[];
  editingTxId?: number | null;
  createdBy?: number;
}

export interface CheckoutResult {
  transaction: Transaction;
  items: TransactionItemRecord[];
}

export async function checkoutAtomic(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.lines.length === 0) throw new CashierOpsError('Keranjang kosong');

  const now = new Date();

  return db.transaction('rw', ...tables(), async () => {
    if (input.editingTxId) {
      const oldItems = await db.transactionItems
        .where('transactionId')
        .equals(input.editingTxId)
        .toArray();

      await db.transactions.update(input.editingTxId, {
        status: 'completed',
        subtotal: input.subtotal,
        discountType: input.discountType,
        discountValue: input.discountValue,
        discountAmount: input.discountAmount,
        total: input.total,
        paymentMethodId: input.paymentAmount > 0 ? input.paymentMethodId : 0,
        paymentAmount: input.paymentAmount,
        change: input.change,
        profit: input.profit,
        customerId: input.customerId,
        customerName: input.customerName,
        tableNumber: input.tableNumber,
        remarks: input.remarks,
        closedAt: now,
        debtAmount: input.debtAmount,
      });

      if (input.debtAmount > 0) {
        if (!input.customerId) throw new CashierOpsError('Pelanggan wajib untuk hutang');
        const debt: Debt = {
          transactionId: input.editingTxId,
          customerId: input.customerId,
          customerName: input.customerName || '',
          originalAmount: input.debtAmount,
          remainingAmount: input.debtAmount,
          status: input.paymentAmount > 0 ? 'partial' : 'unpaid',
          createdAt: now,
          settledAt: null,
        };
        await db.debts.add(debt);
      }

      const items = await replaceItems(input.editingTxId, input.lines);
      await applyOpenBillStockDeltas(oldItems, input.lines);

      const transaction = await db.transactions.get(input.editingTxId);
      if (!transaction) throw new CashierOpsError('Transaksi tidak ditemukan');
      return { transaction, items };
    }

    const receiptNumber = makeReceiptNumber();
    const txData: Transaction = {
      subtotal: input.subtotal,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discountAmount: input.discountAmount,
      total: input.total,
      paymentMethodId: input.paymentAmount > 0 ? input.paymentMethodId : 0,
      paymentAmount: input.paymentAmount,
      change: input.change,
      profit: input.profit,
      date: now,
      receiptNumber,
      status: 'completed',
      customerId: input.customerId,
      customerName: input.customerName,
      tableNumber: input.tableNumber,
      remarks: input.remarks,
      createdBy: input.createdBy,
      debtAmount: input.debtAmount,
      closedAt: now,
    };

    const txId = (await db.transactions.add(txData)) as number;

    if (input.debtAmount > 0) {
      if (!input.customerId) throw new CashierOpsError('Pelanggan wajib untuk hutang');
      await db.debts.add({
        transactionId: txId,
        customerId: input.customerId,
        customerName: input.customerName || '',
        originalAmount: input.debtAmount,
        remainingAmount: input.debtAmount,
        status: input.paymentAmount > 0 ? 'partial' : 'unpaid',
        createdAt: now,
        settledAt: null,
      });
    }

    const items = await replaceItems(txId, input.lines);
    // New completed sale: reserve full cart qty from stock
    await applyOpenBillStockDeltas([], input.lines);

    return { transaction: { ...txData, id: txId }, items };
  });
}
