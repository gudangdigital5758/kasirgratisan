import Dexie, { type Table } from 'dexie';
import type {
  Category, Product, Supplier, Customer, StockIn, StockOut, StockOpname, StockOpnameItem,
  HppHistory, PaymentMethod, Transaction, TransactionItemRecord, Unit, ExpenseCategory,
  Expense, Debt, DebtPayment, DeletedRecord, CashierShift, StoreSettings, User, Role,
} from './db-schema';
import { ALL_PERMISSIONS } from './db-schema';

export class PosDatabase extends Dexie {
  categories!: Table<Category>;
  products!: Table<Product>;
  suppliers!: Table<Supplier>;
  customers!: Table<Customer>;
  stockIns!: Table<StockIn>;
  stockOuts!: Table<StockOut>;
  hppHistory!: Table<HppHistory>;
  paymentMethods!: Table<PaymentMethod>;
  transactions!: Table<Transaction>;
  transactionItems!: Table<TransactionItemRecord>;
  storeSettings!: Table<StoreSettings>;
  users!: Table<User>;
  roles!: Table<Role>;
  units!: Table<Unit>;
  expenseCategories!: Table<ExpenseCategory>;
  expenses!: Table<Expense>;
  debts!: Table<Debt>;
  debtPayments!: Table<DebtPayment>;
  stockOpnames!: Table<StockOpname>;
  stockOpnameItems!: Table<StockOpnameItem>;
  deletedRecords!: Table<DeletedRecord>;
  cashierShifts!: Table<CashierShift>;

  constructor(dbName: string = 'kasirgratisan-db') {
    super(dbName);

    // Version 1 — original schema (must remain for migration path)
    this.version(1).stores({
      categories: '++id, name',
      products: '++id, name, sku, categoryId, barcode',
      suppliers: '++id, name',
      stockIns: '++id, productId, supplierId, date',
      stockOuts: '++id, productId, date',
      hppHistory: '++id, productId, date',
      paymentMethods: '++id, name, category',
      transactions: '++id, date, receiptNumber, paymentMethodId',
      storeSettings: '++id',
    });

    // Version 2 — CR-1 to CR-5
    this.version(2).stores({
      categories: '++id, name, isDeleted',
      products: '++id, name, sku, categoryId, barcode, isDeleted',
      suppliers: '++id, name, isDeleted',
      stockIns: '++id, productId, supplierId, date',
      stockOuts: '++id, productId, date',
      hppHistory: '++id, productId, date',
      paymentMethods: '++id, name, category',
      transactions: '++id, date, &receiptNumber, paymentMethodId',
      transactionItems: '++id, transactionId, productId',
      storeSettings: '++id',
    }).upgrade(async (tx) => {
      // CR-2: Set soft delete defaults on existing records
      const catTable = tx.table<Category, number>('categories');
      await catTable.toCollection().modify((cat) => {
        cat.isDeleted = 0;
        cat.deletedAt = null;
      });

      const prodTable = tx.table<Product, number>('products');
      await prodTable.toCollection().modify((prod) => {
        prod.isDeleted = 0;
        prod.deletedAt = null;
      });

      const supTable = tx.table<Supplier, number>('suppliers');
      await supTable.toCollection().modify((sup) => {
        sup.isDeleted = 0;
        sup.deletedAt = null;
      });

      // CR-1: Generate deviceId for existing storeSettings
      const storeTable = tx.table<StoreSettings, number>('storeSettings');
      await storeTable.toCollection().modify((s) => {
        s.deviceId = crypto.randomUUID();
      });

      // CR-5: Migrate embedded items[] from transactions to transactionItems table
      // (skema v1 menyimpan item di dalam transaksi — field `items` sudah tidak ada di tipe modern)
      type LegacyEmbeddedItem = {
        productId: number;
        productName: string;
        quantity: number;
        price: number;
        hpp: number;
        discountType: 'percentage' | 'nominal' | null;
        discountValue: number;
        discountAmount: number;
        subtotal: number;
      };
      type LegacyTransaction = Transaction & { items?: LegacyEmbeddedItem[] };

      const txTable = tx.table<LegacyTransaction, number>('transactions');
      const itemsTable = tx.table<TransactionItemRecord, number>('transactionItems');
      const allTx = await txTable.toArray();

      for (const t of allTx) {
        const items = t.items;
        if (Array.isArray(items) && items.length > 0) {
          const records: TransactionItemRecord[] = items.map((item) => ({
            transactionId: t.id!,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
            hpp: item.hpp,
            discountType: item.discountType,
            discountValue: item.discountValue,
            discountAmount: item.discountAmount,
            subtotal: item.subtotal,
          }));
          await itemsTable.bulkAdd(records);
        }
        // Remove embedded items field
        delete t.items;
        await txTable.put(t);
      }
    });

    // Version 3 — Open Bill: status, orderNumber, customer/table, item notes
    this.version(3).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
    }).upgrade(async (tx) => {
      // Set all existing transactions to 'completed' status
      await tx.table<Transaction, number>('transactions').toCollection().modify((t) => {
        t.status = 'completed';
      });
    });

    // Version 4 — SKU unique constraint
    this.version(4).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
    }).upgrade(async (tx) => {
      // Deduplicate SKUs before applying unique constraint
      const prodTable = tx.table<Product, number>('products');
      const allProducts = await prodTable.toArray();
      const seenSku = new Map<string, number>(); // sku -> first occurrence index

      for (const p of allProducts) {
        const sku = p.sku?.trim();
        if (!sku) continue;

        if (seenSku.has(sku)) {
          // Duplicate SKU found — append suffix to make unique
          let counter = 1;
          let newSku = `${sku}_dup${counter}`;
          while (seenSku.has(newSku)) {
            counter++;
            newSku = `${sku}_dup${counter}`;
          }
          seenSku.set(newSku, p.id ?? 0);
          await prodTable.update(p.id!, { sku: newSku });
        } else {
          seenSku.set(sku, p.id ?? 0);
        }
      }
    });

    // Version 5 — Units master table (CRUD-able from Settings)
    this.version(5).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
    }).upgrade(async (tx) => {
      // Seed default units + harvest unique units already used by products
      const unitsTable = tx.table<Unit, number>('units');
      const prodTable = tx.table<Product, number>('products');
      const now = new Date();

      const defaults = ['pcs', 'kg', 'gram', 'liter', 'ml', 'porsi', 'cup', 'botol', 'bungkus'];
      const seen = new Set<string>();

      for (const name of defaults) {
        seen.add(name);
        await unitsTable.add({
          name,
          isDefault: 1,
          createdAt: now,
          isDeleted: 0,
          deletedAt: null,
        });
      }

      // Harvest custom units already used by existing products (e.g. 'mangkok', 'gelas')
      const allProducts = await prodTable.toArray();
      for (const p of allProducts) {
        const u = p.unit?.trim();
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        try {
          await unitsTable.add({
            name: u,
            isDefault: 0,
            createdAt: now,
            isDeleted: 0,
            deletedAt: null,
          });
        } catch {
          // ignore unique-constraint races
        }
      }
    });

    // Version 6 — Multi-user (opt-in) + audit trail (createdBy/updatedBy)
    // Notes:
    //   * `users` is a NEW table; existing data is untouched.
    //   * No createdBy/updatedBy is back-filled — existing rows keep undefined,
    //     UI handles that as "—" (legacy).
    //   * `multiUserEnabled` defaults to false → app behaves exactly like before
    //     until owner activates the feature from Settings.
    this.version(6).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
    }).upgrade(async (tx) => {
      // Default multiUserEnabled = false on existing storeSettings
      const storeTable = tx.table('storeSettings');
      await storeTable.toCollection().modify((s: Partial<StoreSettings>) => {
        if (s.multiUserEnabled === undefined) s.multiUserEnabled = false;
      });
    });

    // Version 7 — Expense tracking (separate from StockIn)
    // Notes:
    //   * Two new tables: `expenseCategories` and `expenses`.
    //   * Default categories are seeded in seedDefaultData() so users that
    //     already migrated past v7 still get them on first run.
    //   * Existing data is untouched.
    this.version(7).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
    });

    // Version 8 — "What's New" tracking
    // Notes:
    //   * Pure data migration; schema (indexes) unchanged.
    //   * Default `seenWhatsNewIds = []` for existing rows so the announcement
    //     modal will show all current entries to existing users on first launch
    //     after upgrade — which is exactly what we want.
    this.version(8).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
    }).upgrade(async (tx) => {
      const storeTable = tx.table('storeSettings');
      await storeTable.toCollection().modify((s: Partial<StoreSettings>) => {
        if (!Array.isArray(s.seenWhatsNewIds)) s.seenWhatsNewIds = [];
      });
    });

    // Version 9 — Produk tanpa stok ("Unmanaged Stock")
    // Notes:
    //   * `trackStock` ditambahkan ke setiap produk lama dengan nilai `true`
    //     sehingga perilaku persis sama seperti sebelumnya (stok dikelola).
    //   * Schema (indexes) tidak berubah; ini murni back-fill data.
    //   * Pembacaan di UI memakai pola `trackStock !== false` agar produk yang
    //     entah kenapa belum ter-migrasi (undefined) tetap dianggap "managed".
    this.version(9).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
    }).upgrade(async (tx) => {
      const prodTable = tx.table('products');
      await prodTable.toCollection().modify((p: Partial<Product>) => {
        if (p.trackStock === undefined) p.trackStock = true;
      });
    });

    // Version 10 — Master Pelanggan (Customers)
    // Notes:
    //   * Tabel `customers` BARU; data lama tidak disentuh.
    //   * `customerId` ditambahkan ke transactions (opsional) — tidak di-index
    //     karena query pelanggan-per-transaksi belum diperlukan. `customerName`
    //     snapshot yang sudah ada tetap dipertahankan.
    //   * Tidak ada back-fill: transaksi lama tetap punya customerId undefined.
    this.version(10).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:         '++id, name, isDeleted',
      customers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
    });

    // Version 11 - Customer debt and immutable installment payments.
    this.version(11).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:         '++id, name, isDeleted',
      customers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
      debts:             '++id, &transactionId, customerId, status, createdAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy',
    }).upgrade(async (tx) => {
      await tx.table('storeSettings').toCollection().modify((s: Partial<StoreSettings>) => {
        if (s.allowDebt === undefined) s.allowDebt = false;
      });
    });

    // Version 12 - Add unit index to products table for units management renaming/deletion checks.
    this.version(12).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit',
      suppliers:         '++id, name, isDeleted',
      customers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
      debts:             '++id, &transactionId, customerId, status, createdAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy',
    });

    // Version 13 - Add StockOpname tables.
    this.version(13).stores({
      categories:        '++id, name, isDeleted',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit',
      suppliers:         '++id, name, isDeleted',
      customers:         '++id, name, isDeleted',
      stockIns:          '++id, productId, supplierId, date, createdBy',
      stockOuts:         '++id, productId, date, createdBy',
      hppHistory:        '++id, productId, date',
      paymentMethods:    '++id, name, category',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted',
      users:             '++id, &username, role, isActive',
      expenseCategories: '++id, name, isDeleted',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted',
      debts:             '++id, &transactionId, customerId, status, createdAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy',
      stockOpnames:      '++id, date, status, createdBy',
      stockOpnameItems:  '++id, opnameId, productId, [opnameId+productId]',
    });

    // Version 14 - Add sync audit columns (updatedAt, syncedAt) & deletedRecords table
    this.version(14).stores({
      categories:        '++id, name, isDeleted, updatedAt, syncedAt',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit, updatedAt, syncedAt',
      suppliers:         '++id, name, isDeleted, updatedAt, syncedAt',
      customers:         '++id, name, isDeleted, updatedAt, syncedAt',
      stockIns:          '++id, productId, supplierId, date, createdBy, updatedAt, syncedAt',
      stockOuts:         '++id, productId, date, createdBy, updatedAt, syncedAt',
      hppHistory:        '++id, productId, date, syncedAt',
      paymentMethods:    '++id, name, category, updatedAt, syncedAt',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy, updatedAt, syncedAt',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted, updatedAt, syncedAt',
      users:             '++id, &username, role, isActive, updatedAt, syncedAt',
      expenseCategories: '++id, name, isDeleted, updatedAt, syncedAt',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted, updatedAt, syncedAt',
      debts:             '++id, &transactionId, customerId, status, createdAt, updatedAt, syncedAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy, updatedAt, syncedAt',
      stockOpnames:      '++id, date, status, createdBy, updatedAt, syncedAt',
      stockOpnameItems:  '++id, opnameId, productId, [opnameId+productId]',
      deletedRecords:    '++id, tableName, recordId, deletedAt, syncedAt',
    }).upgrade(async (tx) => {
      const now = new Date();
      type SyncableRecord = Record<string, unknown> & {
        updatedAt?: Date | null;
        syncedAt?: Date | null;
      };
      const backfillTable = async (tableName: string, dateFields: string[]) => {
        const table = tx.table<SyncableRecord, number>(tableName);
        await table.toCollection().modify((record) => {
          if (!record.updatedAt) {
            let baseDate = now;
            for (const field of dateFields) {
              const value = record[field];
              if (value) {
                const parsed = new Date(value as string | number | Date);
                if (!isNaN(parsed.getTime())) {
                  baseDate = parsed;
                  break;
                }
              }
            }
            record.updatedAt = baseDate;
          }
          if (record.syncedAt === undefined) {
            record.syncedAt = null;
          }
        });
      };

      await backfillTable('categories', ['createdAt']);
      await backfillTable('products', ['updatedAt', 'createdAt']);
      await backfillTable('suppliers', ['createdAt']);
      await backfillTable('customers', ['createdAt']);
      await backfillTable('stockIns', ['date']);
      await backfillTable('stockOuts', ['date']);
      
      await tx.table<SyncableRecord, number>('hppHistory').toCollection().modify((record) => {
        if (record.syncedAt === undefined) record.syncedAt = null;
      });

      await backfillTable('paymentMethods', ['createdAt']);
      await backfillTable('transactions', ['date', 'openedAt', 'closedAt']);
      await backfillTable('units', ['createdAt']);
      await backfillTable('users', ['createdAt']);
      await backfillTable('expenseCategories', ['createdAt']);
      await backfillTable('expenses', ['date', 'createdAt']);
      await backfillTable('debts', ['createdAt']);
      await backfillTable('debtPayments', ['date']);
      await backfillTable('stockOpnames', ['date']);
    });

    // Version 15 — Cashier shifts (buka/tutup kas)
    this.version(15).stores({
      categories:        '++id, name, isDeleted, updatedAt, syncedAt',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit, updatedAt, syncedAt',
      suppliers:         '++id, name, isDeleted, updatedAt, syncedAt',
      customers:         '++id, name, isDeleted, updatedAt, syncedAt',
      stockIns:          '++id, productId, supplierId, date, createdBy, updatedAt, syncedAt',
      stockOuts:         '++id, productId, date, createdBy, updatedAt, syncedAt',
      hppHistory:        '++id, productId, date, syncedAt',
      paymentMethods:    '++id, name, category, updatedAt, syncedAt',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy, updatedAt, syncedAt',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted, updatedAt, syncedAt',
      users:             '++id, &username, role, isActive, updatedAt, syncedAt',
      expenseCategories: '++id, name, isDeleted, updatedAt, syncedAt',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted, updatedAt, syncedAt',
      debts:             '++id, &transactionId, customerId, status, createdAt, updatedAt, syncedAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy, updatedAt, syncedAt',
      stockOpnames:      '++id, date, status, createdBy, updatedAt, syncedAt',
      stockOpnameItems:  '++id, opnameId, productId, [opnameId+productId]',
      deletedRecords:    '++id, tableName, recordId, deletedAt, syncedAt',
      cashierShifts:     '++id, status, userId, openedAt, closedAt, updatedAt, syncedAt',
    });

    // Version 16 — Jenis toko (PRODUCT-TYPES): storeType default 'general'.
    // Tidak ada index baru; upgrade hanya backfill untuk storeSettings existing.
    this.version(16).stores({
      categories:        '++id, name, isDeleted, updatedAt, syncedAt',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit, updatedAt, syncedAt',
      suppliers:         '++id, name, isDeleted, updatedAt, syncedAt',
      customers:         '++id, name, isDeleted, updatedAt, syncedAt',
      stockIns:          '++id, productId, supplierId, date, createdBy, updatedAt, syncedAt',
      stockOuts:         '++id, productId, date, createdBy, updatedAt, syncedAt',
      hppHistory:        '++id, productId, date, syncedAt',
      paymentMethods:    '++id, name, category, updatedAt, syncedAt',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy, updatedAt, syncedAt',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted, updatedAt, syncedAt',
      users:             '++id, &username, role, isActive, updatedAt, syncedAt',
      expenseCategories: '++id, name, isDeleted, updatedAt, syncedAt',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted, updatedAt, syncedAt',
      debts:             '++id, &transactionId, customerId, status, createdAt, updatedAt, syncedAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy, updatedAt, syncedAt',
      stockOpnames:      '++id, date, status, createdBy, updatedAt, syncedAt',
      stockOpnameItems:  '++id, opnameId, productId, [opnameId+productId]',
      deletedRecords:    '++id, tableName, recordId, deletedAt, syncedAt',
      cashierShifts:     '++id, status, userId, openedAt, closedAt, updatedAt, syncedAt',
    }).upgrade(async (tx) => {
      // Backfill: toko existing dianggap "umum" (tanpa kolom khusus) agar
      // tidak ada perubahan perilaku untuk user lama.
      await tx.table<StoreSettings, number>('storeSettings').toCollection().modify((s) => {
        if (!s.storeType) s.storeType = 'general';
      });
    });

    // Version 17 — Role bernama (ROLES-PERMISSIONS M0): tabel roles + roleId di user.
    // Tidak ada index baru di tabel inti; upgrade men-seed role bawaan & memetakan
    // user staff lama ke role Sales (permissions existing dipertahankan).
    this.version(17).stores({
      categories:        '++id, name, isDeleted, updatedAt, syncedAt',
      products:          '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy, unit, updatedAt, syncedAt',
      suppliers:         '++id, name, isDeleted, updatedAt, syncedAt',
      customers:         '++id, name, isDeleted, updatedAt, syncedAt',
      stockIns:          '++id, productId, supplierId, date, createdBy, updatedAt, syncedAt',
      stockOuts:         '++id, productId, date, createdBy, updatedAt, syncedAt',
      hppHistory:        '++id, productId, date, syncedAt',
      paymentMethods:    '++id, name, category, updatedAt, syncedAt',
      transactions:      '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy, updatedAt, syncedAt',
      transactionItems:  '++id, transactionId, productId',
      storeSettings:     '++id',
      units:             '++id, &name, isDeleted, updatedAt, syncedAt',
      users:             '++id, &username, role, isActive, updatedAt, syncedAt',
      roles:             '++id, name, isBuiltIn, isActive, updatedAt, syncedAt',
      expenseCategories: '++id, name, isDeleted, updatedAt, syncedAt',
      expenses:          '++id, date, categoryId, paymentMethodId, createdBy, isDeleted, updatedAt, syncedAt',
      debts:             '++id, &transactionId, customerId, status, createdAt, updatedAt, syncedAt',
      debtPayments:      '++id, debtId, date, paymentMethodId, createdBy, updatedAt, syncedAt',
      stockOpnames:      '++id, date, status, createdBy, updatedAt, syncedAt',
      stockOpnameItems:  '++id, opnameId, productId, [opnameId+productId]',
      deletedRecords:    '++id, tableName, recordId, deletedAt, syncedAt',
      cashierShifts:     '++id, status, userId, openedAt, closedAt, updatedAt, syncedAt',
    }).upgrade(async (tx) => {
      const now = new Date();
      const rolesTable = tx.table<Role, number>('roles');
      const roleCount = await rolesTable.count();
      if (roleCount === 0) {
        const salesId = await rolesTable.add({
          name: 'Sales',
          permissions: ['create_transaction'],
          isBuiltIn: 1,
          isActive: 1,
          createdAt: now,
          syncedAt: null,
        });
        await rolesTable.add({
          name: 'Admin',
          permissions: [...ALL_PERMISSIONS],
          isBuiltIn: 1,
          isActive: 1,
          createdAt: now,
          syncedAt: null,
        });
        // Map user staff lama ke role Sales; owner/Administrator implicit (tanpa roleId).
        await tx.table<User, number>('users').toCollection().modify((u) => {
          if (u.role === 'staff' && u.roleId === undefined) {
            u.roleId = salesId as number;
          }
        });
      }
    });
  }
}

