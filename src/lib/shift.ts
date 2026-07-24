/**
 * Cashier shift helpers — open/close cash drawer, expected cash from period activity.
 */
import { db, type CashierShift, type PaymentMethod } from './db';

export function isCashPaymentMethod(method: PaymentMethod | undefined): boolean {
  if (!method) return false;
  const cat = (method.category || '').toLowerCase();
  const name = (method.name || '').toLowerCase();
  return cat === 'tunai' || cat === 'cash' || name.includes('tunai') || name === 'cash';
}

export async function getOpenShift(userId?: number | null): Promise<CashierShift | undefined> {
  const open = await db.cashierShifts.where('status').equals('open').toArray();
  if (userId != null) {
    return open.find((s) => s.userId === userId) ?? open.find((s) => s.userId == null);
  }
  return open[0];
}

export async function openShift(params: {
  userId: number | null;
  userName: string;
  openingCash: number;
}): Promise<number> {
  const existing = await getOpenShift(params.userId);
  if (existing) {
    throw new Error('SHIFT_ALREADY_OPEN');
  }
  const now = new Date();
  return db.cashierShifts.add({
    userId: params.userId,
    userName: params.userName,
    openedAt: now,
    closedAt: null,
    openingCash: Math.max(0, params.openingCash),
    closingCash: null,
    expectedCash: null,
    cashSales: 0,
    cashExpenses: 0,
    txCount: 0,
    salesTotal: 0,
    status: 'open',
    updatedAt: now,
    syncedAt: null,
  });
}

export async function computeShiftTotals(openedAt: Date, closedAt: Date = new Date()) {
  const methods = await db.paymentMethods.toArray();
  const cashIds = new Set(
    methods.filter(isCashPaymentMethod).map((m) => m.id!).filter((id) => id != null),
  );

  const txs = await db.transactions
    .where('date')
    .between(openedAt, closedAt, true, true)
    .filter((t) => t.status === 'completed')
    .toArray();

  let cashSales = 0;
  let salesTotal = 0;
  let profitTotal = 0;
  for (const t of txs) {
    salesTotal += t.total;
    profitTotal += t.profit;
    if (cashIds.has(t.paymentMethodId)) {
      cashSales += Math.min(t.paymentAmount, t.total);
    }
  }

  const debtPayments = await db.debtPayments
    .where('date')
    .between(openedAt, closedAt, true, true)
    .toArray();
  for (const p of debtPayments) {
    if (cashIds.has(p.paymentMethodId)) {
      cashSales += p.amount;
    }
  }

  const expenses = await db.expenses
    .where('date')
    .between(openedAt, closedAt, true, true)
    .filter((e) => e.isDeleted === 0)
    .toArray();
  let cashExpenses = 0;
  let expensesTotal = 0;
  for (const e of expenses) {
    expensesTotal += e.amount;
    if (cashIds.has(e.paymentMethodId)) {
      cashExpenses += e.amount;
    }
  }

  return {
    cashSales,
    cashExpenses,
    salesTotal,
    profitTotal,
    expensesTotal,
    txCount: txs.length,
    expectedCash: 0, // filled by caller with opening
  };
}

export async function closeShift(params: {
  shiftId: number;
  closingCash: number;
  notes?: string;
}): Promise<CashierShift> {
  const shift = await db.cashierShifts.get(params.shiftId);
  if (!shift || shift.status !== 'open') {
    throw new Error('SHIFT_NOT_OPEN');
  }
  const closedAt = new Date();
  const totals = await computeShiftTotals(new Date(shift.openedAt), closedAt);
  const expectedCash = shift.openingCash + totals.cashSales - totals.cashExpenses;
  const updated: CashierShift = {
    ...shift,
    closedAt,
    closingCash: Math.max(0, params.closingCash),
    expectedCash,
    cashSales: totals.cashSales,
    cashExpenses: totals.cashExpenses,
    txCount: totals.txCount,
    salesTotal: totals.salesTotal,
    notes: params.notes?.trim() || undefined,
    status: 'closed',
    updatedAt: closedAt,
    syncedAt: null,
  };
  await db.cashierShifts.put(updated);
  return updated;
}

export function shiftVariance(shift: Pick<CashierShift, 'closingCash' | 'expectedCash'>): number | null {
  if (shift.closingCash == null || shift.expectedCash == null) return null;
  return shift.closingCash - shift.expectedCash;
}
