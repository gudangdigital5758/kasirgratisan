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
  type StockLotAllocation,
  type Debt,
} from '@/lib/db';
import { consumeFifo, restoreToLot, type FifoConsumption } from '@/lib/inventory';

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
  return [
    db.transactions,
    db.transactionItems,
    db.products,
    db.stockLots,
    db.stockLotAllocations,
  ] as const;
}

async function runAtomic<R>(fn: () => Promise<R>): Promise<R> {
  return db.transaction('rw', ...tables(), fn);
}

/** Tulis alokasi batch hasil konsumsi FIFO untuk sebuah item transaksi. */
async function writeAllocations(
  consumption: FifoConsumption,
  transactionId: number,
  transactionItemId: number,
): Promise<void> {
  if (consumption.allocations.length === 0) return;
  const rows: StockLotAllocation[] = consumption.allocations.map((a) => ({
    ...a,
    transactionId,
    transactionItemId,
  }));
  await db.stockLotAllocations.bulkAdd(rows);
}

/**
 * Konsumsi FIFO satu baris cart (dipakai untuk snapshot HPP & alokasi batch).
 * `lineTxId`/`itemId` boleh 0 bila pemanggil hanya butuh angka (pratinjau).
 */
async function consumeForLine(
  line: CartLine,
  transactionId: number,
  itemId: number,
): Promise<FifoConsumption> {
  const product = (await db.products.get(line.product.id!)) ?? line.product;
  const consumption = await consumeFifo(product, line.qty);
  await writeAllocations(consumption, transactionId, itemId);
  return consumption;
}

/** deltaSold > 0 mengurangi stok; < 0 mengembalikan stok. (Jalur legacy tanpa batch.) */
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
  const itemRecords: TransactionItemRecord[] = [];
  for (const c of lines) {
    const consumption = await consumeForLine(c, transactionId, 0);
    const id = (await db.transactionItems.add({
      transactionId,
      productId: c.product.id!,
      productName: c.product.name,
      quantity: c.qty,
      price: c.product.price,
      hpp: consumption.unitCost > 0 ? consumption.unitCost : c.product.hpp,
      costAmount: consumption.costAmount,
      discountType: c.discountType,
      discountValue: c.discountValue,
      discountAmount: c.discountAmount,
      subtotal: c.lineSubtotal,
      notes: c.notes,
    })) as number;
    await db.stockLotAllocations
      .where('transactionItemId')
      .equals(0)
      .and((a) => a.transactionId === transactionId)
      .modify({ transactionItemId: id, transactionId });
    itemRecords.push((await db.transactionItems.get(id)) as TransactionItemRecord);
  }
  return itemRecords;
}

/** Kembalikan stok + hapus alokasi untuk item transaksi lama (open bill lama). */
async function restoreItems(
  items: TransactionItemRecord[],
  transactionId: number,
): Promise<void> {
  for (const item of items) {
    const allocations = await db.stockLotAllocations
      .where('transactionId')
      .equals(transactionId)
      .and((a) => a.transactionItemId === item.id!)
      .toArray();
    if (allocations.length === 0) {
      // Legacy (transaksi lama tanpa alokasi FIFO): kembalikan langsung ke
      // batch saldo awal bila produk dikelola stoknya.
      const product = await db.products.get(item.productId);
      if (product && isStockManaged(product)) {
        await db.products.update(item.productId, {
          stock: (product.stock ?? 0) + item.quantity,
          updatedAt: new Date(),
        });
      }
      continue;
    }
    for (const a of allocations) {
      await restoreToLot(a);
      await db.stockLotAllocations.delete(a.id!);
    }
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

  return runAtomic(async () => {
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

      await restoreItems(oldItems, input.editingTxId);
      await db.transactionItems.where('transactionId').equals(input.editingTxId).delete();

      const items = await replaceItems(input.editingTxId, input.lines);

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

    return { transaction: { ...txData, id: txId }, items };
  });
}

export async function cancelOpenBillAtomic(tx: Transaction): Promise<void> {
  if (!tx.id) throw new CashierOpsError('ID transaksi tidak valid');
  const txId = tx.id;

  await runAtomic(async () => {
    const items = await db.transactionItems.where('transactionId').equals(txId).toArray();
    await restoreItems(items, txId);
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
  /** Profit aktual = total − Σ costAmount FIFO (bukan estimasi UI). */
  realProfit: number;
}

export async function checkoutAtomic(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.lines.length === 0) throw new CashierOpsError('Keranjang kosong');

  const now = new Date();

  return runAtomic(async () => {
    if (input.editingTxId) {
      const oldItems = await db.transactionItems
        .where('transactionId')
        .equals(input.editingTxId)
        .toArray();

      // Kembalikan stok open bill lama ke batch asal sebelum item baru dibuat.
      await restoreItems(oldItems, input.editingTxId);
      await db.transactionItems.where('transactionId').equals(input.editingTxId).delete();

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
      const realProfit = input.total - items.reduce((s, i) => s + (i.costAmount ?? 0), 0);
      await db.transactions.update(input.editingTxId, { profit: realProfit });

      const transaction = await db.transactions.get(input.editingTxId);
      if (!transaction) throw new CashierOpsError('Transaksi tidak ditemukan');
      return { transaction, items, realProfit };
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
      profit: 0, // diisi realProfit setelah item dibuat
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
    const realProfit = input.total - items.reduce((s, i) => s + (i.costAmount ?? 0), 0);
    await db.transactions.update(txId, { profit: realProfit });

    return { transaction: { ...txData, id: txId, profit: realProfit }, items, realProfit };
  });
}
