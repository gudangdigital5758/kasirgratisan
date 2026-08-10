import { format, endOfDay, startOfDay } from 'date-fns';
import type * as ExcelJSTypes from 'exceljs';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { db } from '@/lib/db';
import type { Transaction, TransactionItemRecord, Expense } from '@/lib/db';

/**
 * Client-side Excel export untuk halaman Laporan.
 *
 * Semua data dibaca langsung dari IndexedDB (Dexie) dan workbook dibangun di
 * browser — tidak ada backend. ExcelJS di-import dinamis agar bundle-nya
 * ter-code-split dan tidak membebani load awal aplikasi.
 *
 * Aturan yang dijaga konsisten dengan tampilan Laporan:
 *  - hanya transaksi `status === 'completed'` (open bill dikecualikan),
 *  - hanya pengeluaran `isDeleted === 0`.
 */

const CURRENCY_FMT = '#,##0';

export interface ExportResult {
  fileName: string;
  txCount: number;
  itemCount: number;
  expenseCount: number;
}

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000; // hindari "Maximum call stack" pada file besar
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Simpan / bagikan file. Di web: unduh lewat anchor. Di native (Capacitor):
 * tulis ke cache lalu buka dialog Share Android — mengikuti pola backup.
 */
async function saveFile(buffer: ArrayBuffer, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: arrayBufferToBase64(buffer),
      directory: Directory.Cache,
    });
    await Share.share({
      title: 'Laporan Excel',
      text: fileName,
      url: result.uri,
      dialogTitle: 'Simpan / Bagikan Laporan',
    });
    return;
  }

  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeForFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') || 'Toko';
}

export async function exportReportToExcel(rangeStart: Date, rangeEnd: Date): Promise<ExportResult> {
  // Normalisasi batas hari supaya inklusif (00:00:00 s/d 23:59:59.999).
  const start = startOfDay(rangeStart);
  const end = endOfDay(rangeEnd);

  // --- Ambil data ---
  const [allTx, expensesRaw, debtPayments, paymentMethods, expenseCategories, users, storeSettings] =
    await Promise.all([
      db.transactions.where('date').between(start, end, true, true).toArray(),
      db.expenses.where('date').between(start, end, true, true).toArray(),
      db.debtPayments.where('date').between(start, end, true, true).toArray(),
      db.paymentMethods.toArray(),
      db.expenseCategories.toArray(),
      db.users.toArray(),
      db.storeSettings.toCollection().first(),
    ]);

  const transactions = allTx
    .filter((t) => t.status === 'completed')
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const expenses = expensesRaw
    .filter((e) => e.isDeleted === 0)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));

  const txIds = transactions.map((t) => t.id!).filter(Boolean);
  const items =
    txIds.length > 0
      ? await db.transactionItems.where('transactionId').anyOf(txIds).toArray()
      : [];

  // --- Lookup helpers ---
  const paymentName = (id?: number) =>
    paymentMethods.find((p) => p.id === id)?.name ?? 'Tanpa metode';
  const categoryName = (id: number) =>
    expenseCategories.find((c) => c.id === id)?.name ?? 'Tanpa kategori';
  const cashierName = (id?: number) =>
    id != null ? users.find((u) => u.id === id)?.name ?? '-' : '-';
  const txById = new Map(transactions.map((t) => [t.id, t] as const));

  const storeName = storeSettings?.storeName?.trim() || 'Kasir';

  // --- Agregasi untuk sheet Ringkasan ---
  const totalSales = transactions.reduce((s, t) => s + t.total, 0);
  const totalProfit = transactions.reduce((s, t) => s + t.profit, 0);
  const totalRevenue = transactions.reduce((s, t) => s + t.subtotal, 0);
  const totalDiscount = transactions.reduce((s, t) => s + t.discountAmount, 0);
  const totalHpp = items.reduce((s, i) => s + (i.costAmount ?? i.hpp * i.quantity), 0);
  const netSales = totalRevenue - totalDiscount;
  const grossProfit = netSales - totalHpp;
  const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalCashIn =
    transactions.reduce((sum, transaction) => sum + Math.min(transaction.paymentAmount, transaction.total), 0) +
    debtPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const netProfit = grossProfit - totalExpenses;
  const netMargin = netSales > 0 ? (netProfit / netSales) * 100 : 0;

  // Breakdown metode bayar (penjualan).
  const paymentSummary = new Map<string, { amount: number; count: number }>();
  for (const t of transactions) {
    if (t.paymentAmount <= 0) continue;
    const key = paymentName(t.paymentMethodId);
    const cur = paymentSummary.get(key) ?? { amount: 0, count: 0 };
    cur.amount += Math.min(t.paymentAmount, t.total);
    cur.count += 1;
    paymentSummary.set(key, cur);
  }
  for (const payment of debtPayments) {
    const key = paymentName(payment.paymentMethodId);
    const cur = paymentSummary.get(key) ?? { amount: 0, count: 0 };
    cur.amount += payment.amount;
    cur.count += 1;
    paymentSummary.set(key, cur);
  }

  // Pengeluaran per kategori.
  const expenseSummary = new Map<string, number>();
  for (const e of expenses) {
    const key = categoryName(e.categoryId);
    expenseSummary.set(key, (expenseSummary.get(key) ?? 0) + e.amount);
  }

  // --- Bangun workbook ---
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as unknown as { default?: typeof ExcelJSModule }).default ?? ExcelJSModule;

  const wb = new ExcelJS.Workbook();
  wb.creator = storeName;
  wb.created = end;

  buildSummarySheet(wb, {
    storeName,
    start,
    end,
    txCount: transactions.length,
    totalSales,
    totalCashIn,
    totalProfit,
    totalRevenue,
    totalDiscount,
    netSales,
    totalHpp,
    grossProfit,
    grossMargin,
    totalExpenses,
    netProfit,
    netMargin,
    paymentSummary,
    expenseSummary,
  });
  buildTransactionsSheet(wb, transactions, { paymentName, cashierName });
  buildItemsSheet(wb, items, txById);
  buildExpensesSheet(wb, expenses, { paymentName, categoryName });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `Laporan_${sanitizeForFileName(storeName)}_${format(start, 'yyyy-MM-dd')}_${format(
    end,
    'yyyy-MM-dd',
  )}.xlsx`;
  await saveFile(buffer as ArrayBuffer, fileName);

  return {
    fileName,
    txCount: transactions.length,
    itemCount: items.length,
    expenseCount: expenses.length,
  };
}

type Workbook = ExcelJSTypes.Workbook;
type Worksheet = ExcelJSTypes.Worksheet;

interface SummaryData {
  storeName: string;
  start: Date;
  end: Date;
  txCount: number;
  totalSales: number;
  totalCashIn: number;
  totalProfit: number;
  totalRevenue: number;
  totalDiscount: number;
  netSales: number;
  totalHpp: number;
  grossProfit: number;
  grossMargin: number;
  totalExpenses: number;
  netProfit: number;
  netMargin: number;
  paymentSummary: Map<string, { amount: number; count: number }>;
  expenseSummary: Map<string, number>;
}

function styleHeaderRow(row: ExcelJSTypes.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA7B0D' } };
    cell.alignment = { vertical: 'middle' };
  });
}

function buildSummarySheet(wb: Workbook, d: SummaryData) {
  const ws = wb.addWorksheet('Ringkasan');
  ws.columns = [{ width: 30 }, { width: 22 }];

  const titleRow = ws.addRow([`Laporan ${d.storeName}`]);
  titleRow.font = { bold: true, size: 14 };
  ws.addRow([
    'Periode',
    `${format(d.start, 'dd/MM/yyyy')} – ${format(d.end, 'dd/MM/yyyy')}`,
  ]);
  ws.addRow(['Dibuat', format(d.end, 'dd/MM/yyyy HH:mm')]);
  ws.addRow([]);

  const moneyRow = (label: string, value: number, bold = false) => {
    const row = ws.addRow([label, value]);
    row.getCell(2).numFmt = CURRENCY_FMT;
    if (bold) row.font = { bold: true };
    return row;
  };
  const pctRow = (label: string, value: number) => {
    const row = ws.addRow([label, value / 100]);
    row.getCell(2).numFmt = '0.0%';
  };

  ws.addRow(['Jumlah Transaksi', d.txCount]);
  moneyRow('Total Omzet', d.totalSales);
  moneyRow('Kas Masuk', d.totalCashIn);
  ws.addRow([]);
  moneyRow('Pendapatan Kotor', d.totalRevenue);
  moneyRow('Diskon', -d.totalDiscount);
  moneyRow('Penjualan Bersih', d.netSales, true);
  moneyRow('HPP (Modal)', -d.totalHpp);
  moneyRow('Laba Kotor', d.grossProfit, true);
  pctRow('Margin Kotor', d.grossMargin);
  moneyRow('Total Pengeluaran', -d.totalExpenses);
  moneyRow('Laba Bersih', d.netProfit, true);
  pctRow('Margin Bersih', d.netMargin);

  // Breakdown metode bayar
  ws.addRow([]);
  const payHeader = ws.addRow(['Metode Bayar', 'Jumlah', 'Transaksi']);
  styleHeaderRow(payHeader);
  if (d.paymentSummary.size === 0) {
    ws.addRow(['—', 0, 0]);
  } else {
    for (const [name, v] of [...d.paymentSummary.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
      const row = ws.addRow([name, v.amount, v.count]);
      row.getCell(2).numFmt = CURRENCY_FMT;
    }
  }

  // Pengeluaran per kategori
  ws.addRow([]);
  const expHeader = ws.addRow(['Pengeluaran per Kategori', 'Jumlah']);
  styleHeaderRow(expHeader);
  if (d.expenseSummary.size === 0) {
    ws.addRow(['—', 0]);
  } else {
    for (const [name, amount] of [...d.expenseSummary.entries()].sort((a, b) => b[1] - a[1])) {
      const row = ws.addRow([name, amount]);
      row.getCell(2).numFmt = CURRENCY_FMT;
    }
  }
}

function setupTable(
  ws: Worksheet,
  columns: { header: string; key: string; width: number; money?: boolean }[],
) {
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  const headerRow = ws.addRow(columns.map((c) => c.header));
  styleHeaderRow(headerRow);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return columns;
}

function buildTransactionsSheet(
  wb: Workbook,
  transactions: Transaction[],
  helpers: { paymentName: (id?: number) => string; cashierName: (id?: number) => string },
) {
  const ws = wb.addWorksheet('Transaksi');
  const columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'No. Struk', key: 'receipt', width: 16 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Waktu', key: 'time', width: 8 },
    { header: 'Pelanggan', key: 'customer', width: 20 },
    { header: 'Meja', key: 'table', width: 8 },
    { header: 'Metode Bayar', key: 'payment', width: 16 },
    { header: 'Dibayar', key: 'paid', width: 14, money: true },
    { header: 'Hutang Awal', key: 'debt', width: 14, money: true },
    { header: 'Kasir', key: 'cashier', width: 16 },
    { header: 'Subtotal', key: 'subtotal', width: 14, money: true },
    { header: 'Diskon', key: 'discount', width: 12, money: true },
    { header: 'Total', key: 'total', width: 14, money: true },
    { header: 'Profit', key: 'profit', width: 14, money: true },
  ];
  setupTable(ws, columns);

  transactions.forEach((t, i) => {
    ws.addRow({
      no: i + 1,
      receipt: t.receiptNumber,
      date: format(new Date(t.date), 'dd/MM/yyyy'),
      time: format(new Date(t.date), 'HH:mm'),
      customer: t.customerName ?? '-',
      table: t.tableNumber ?? '-',
      payment: t.debtAmount
        ? `${t.paymentAmount > 0 ? `${helpers.paymentName(t.paymentMethodId)} + ` : ''}Hutang`
        : helpers.paymentName(t.paymentMethodId),
      paid: Math.min(t.paymentAmount, t.total),
      debt: t.debtAmount ?? 0,
      cashier: helpers.cashierName(t.createdBy),
      subtotal: t.subtotal,
      discount: t.discountAmount,
      total: t.total,
      profit: t.profit,
    });
  });

  addTotalsRow(ws, columns, transactions.length, {
    subtotal: transactions.reduce((s, t) => s + t.subtotal, 0),
    discount: transactions.reduce((s, t) => s + t.discountAmount, 0),
    total: transactions.reduce((s, t) => s + t.total, 0),
    paid: transactions.reduce((s, t) => s + Math.min(t.paymentAmount, t.total), 0),
    debt: transactions.reduce((s, t) => s + (t.debtAmount ?? 0), 0),
    profit: transactions.reduce((s, t) => s + t.profit, 0),
  });
  applyMoneyFormat(ws, columns);
}

function buildItemsSheet(
  wb: Workbook,
  items: TransactionItemRecord[],
  txById: Map<number | undefined, Transaction>,
) {
  const ws = wb.addWorksheet('Detail Item');
  const columns = [
    { header: 'No. Struk', key: 'receipt', width: 16 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Produk', key: 'product', width: 28 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Harga', key: 'price', width: 14, money: true },
    { header: 'HPP', key: 'hpp', width: 14, money: true },
    { header: 'Diskon', key: 'discount', width: 12, money: true },
    { header: 'Subtotal', key: 'subtotal', width: 14, money: true },
    { header: 'Laba', key: 'profit', width: 14, money: true },
  ];
  setupTable(ws, columns);

  // Urutkan item mengikuti urutan transaksi (tanggal), lalu nama produk.
  const sorted = [...items].sort((a, b) => {
    const ta = txById.get(a.transactionId);
    const tb = txById.get(b.transactionId);
    const da = ta ? +new Date(ta.date) : 0;
    const dbb = tb ? +new Date(tb.date) : 0;
    return da - dbb;
  });

  for (const item of sorted) {
    const tx = txById.get(item.transactionId);
    ws.addRow({
      receipt: tx?.receiptNumber ?? '-',
      date: tx ? format(new Date(tx.date), 'dd/MM/yyyy') : '-',
      product: item.productName,
      qty: item.quantity,
      price: item.price,
      hpp: item.hpp,
      discount: item.discountAmount,
      subtotal: item.subtotal,
      profit: (item.price * item.quantity - (item.costAmount ?? item.hpp * item.quantity)) - item.discountAmount,
    });
  }

  addTotalsRow(ws, columns, items.length, {
    qty: items.reduce((s, i) => s + i.quantity, 0),
    discount: items.reduce((s, i) => s + i.discountAmount, 0),
    subtotal: items.reduce((s, i) => s + i.subtotal, 0),
    profit: items.reduce((s, i) => s + ((i.price * i.quantity - (i.costAmount ?? i.hpp * i.quantity)) - i.discountAmount), 0),
  });
  applyMoneyFormat(ws, columns);
}

function buildExpensesSheet(
  wb: Workbook,
  expenses: Expense[],
  helpers: { paymentName: (id?: number) => string; categoryName: (id: number) => string },
) {
  const ws = wb.addWorksheet('Pengeluaran');
  const columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Judul', key: 'title', width: 30 },
    { header: 'Kategori', key: 'category', width: 18 },
    { header: 'Metode Bayar', key: 'payment', width: 16 },
    { header: 'Nominal', key: 'amount', width: 14, money: true },
    { header: 'Catatan', key: 'notes', width: 30 },
  ];
  setupTable(ws, columns);

  expenses.forEach((e, i) => {
    ws.addRow({
      no: i + 1,
      date: format(new Date(e.date), 'dd/MM/yyyy'),
      title: e.title,
      category: helpers.categoryName(e.categoryId),
      payment: helpers.paymentName(e.paymentMethodId),
      amount: e.amount,
      notes: e.notes ?? '',
    });
  });

  addTotalsRow(ws, columns, expenses.length, {
    amount: expenses.reduce((s, e) => s + e.amount, 0),
  });
  applyMoneyFormat(ws, columns);
}

function addTotalsRow(
  ws: Worksheet,
  columns: { key: string; money?: boolean }[],
  count: number,
  totals: Record<string, number>,
) {
  if (count === 0) return;
  const firstKey = columns[0].key;
  const data: Record<string, string | number> = { [firstKey]: 'TOTAL', ...totals };
  const row = ws.addRow(data);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.border = { top: { style: 'thin' } };
  });
}

function applyMoneyFormat(ws: Worksheet, columns: { key: string; money?: boolean }[]) {
  for (const col of columns) {
    if (col.money) ws.getColumn(col.key).numFmt = CURRENCY_FMT;
  }
}
