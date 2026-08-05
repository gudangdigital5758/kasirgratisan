import { PosDatabase } from './db-migrations';
import type { Table } from 'dexie';
import { ALL_PERMISSIONS } from './db-schema';
import type { Product } from './db-schema';
import { getActiveStoreKey, DEFAULT_STORE_KEY, dbNameForStore, ensureDefaultStoreEntry } from './store-registry';

// Re-export untuk backward compatibility: seluruh import 'from @/lib/db' tetap bekerja.
export { PosDatabase } from './db-migrations';
export { ALL_PERMISSIONS } from './db-schema';
export type {
  PermissionKey,
  User,
  Role,
  Category,
  Product,
  Supplier,
  Customer,
  StockIn,
  StockOut,
  StockOpname,
  StockOpnameItem,
  HppHistory,
  PaymentMethod,
  Transaction,
  TransactionItemRecord,
  Unit,
  ExpenseCategory,
  Expense,
  Debt,
  DebtPayment,
  DeletedRecord,
  CashierShift,
  StoreSettings,
  StoreCustomField,
} from './db-schema';

// === Multi-toko (MULTI-STORE M1): db mengikuti toko aktif ===
// Saat load, baca toko aktif dari localStorage. Ganti toko = set active key +
// reload (seluruh aplikasi otomatis memakai DB toko tsb).
const activeDbKey = getActiveStoreKey();
export const db =
  activeDbKey === DEFAULT_STORE_KEY ? new PosDatabase() : new PosDatabase(dbNameForStore(activeDbKey));
setupSyncHooks(db);

// Instance tambahan untuk toko lain (preview / operasi lintas toko).
const storeDbs = new Map<string, PosDatabase>();

/**
 * Ambil instance DB untuk sebuah toko. Tanpa argumen → toko aktif.
 * Toko default (key 'default') mengembalikan `db` yang sama.
 */
export function getDb(storeKey?: string): PosDatabase {
  const key = storeKey ?? getActiveStoreKey();
  if (key === DEFAULT_STORE_KEY) return db;
  let inst = storeDbs.get(key);
  if (!inst) {
    inst = new PosDatabase(dbNameForStore(key));
    setupSyncHooks(inst);
    storeDbs.set(key, inst);
  }
  return inst;
}

// Apakah stok produk dikelola? `undefined`/`true` = dikelola (perilaku lama),
// `false` = tidak dikelola (produk selalu tersedia, stok diabaikan).
export function isStockManaged(product: Pick<Product, 'trackStock'>): boolean {
  return product.trackStock !== false;
}

async function sanitizeTableDates<T>(table: Table<T, number>, dateFields: string[]) {
  try {
    await table.toCollection().modify((record) => {
      const r = record as Record<string, unknown>;
      let changed = false;
      for (const field of dateFields) {
        const value = r[field];
        if (value !== undefined && value !== null && typeof value === 'string') {
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            r[field] = parsed;
            changed = true;
          }
        }
      }
    });
  } catch (err) {
    console.error(`Failed to sanitize table ${table.name || 'unknown'} dates:`, err);
  }
}

export async function sanitizeDatabaseDates() {
  await sanitizeTableDates(db.categories, ['createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.products, ['createdAt', 'updatedAt', 'deletedAt', 'syncedAt']);
  await sanitizeTableDates(db.suppliers, ['createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.customers, ['createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.stockIns, ['date', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.stockOuts, ['date', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.hppHistory, ['date', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.paymentMethods, ['createdAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.transactions, ['date', 'openedAt', 'closedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.users, ['createdAt', 'lastLoginAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.units, ['createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.expenseCategories, ['createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.expenses, ['date', 'createdAt', 'deletedAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.debts, ['createdAt', 'settledAt', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.debtPayments, ['date', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.stockOpnames, ['date', 'updatedAt', 'syncedAt']);
  await sanitizeTableDates(db.deletedRecords, ['deletedAt', 'syncedAt']);
  await sanitizeTableDates(db.storeSettings, ['lastBackupAt', 'lastCloudBackupAt']);
  await sanitizeTableDates(db.cashierShifts, ['openedAt', 'closedAt', 'updatedAt', 'syncedAt']);
}

export function setupSyncHooks(db: PosDatabase) {
  const syncTables = [
    'categories',
    'products',
    'suppliers',
    'customers',
    'units',
    'paymentMethods',
    'users',
    'expenseCategories',
    'expenses',
    'transactions',
    'stockIns',
    'stockOuts',
    'hppHistory',
    'debts',
    'debtPayments',
    'stockOpnames',
    'cashierShifts',
  ];

  syncTables.forEach((tableName) => {
    const table = db.table<Record<string, unknown>, number>(tableName);

    table.hook('creating', (primKey, obj: Record<string, unknown>) => {
      if (!obj.updatedAt) {
        obj.updatedAt = new Date();
      }
      if (obj.syncedAt === undefined) {
        obj.syncedAt = null;
      }
    });

    table.hook('updating', (mods: Record<string, unknown>, primKey, obj) => {
      // If the update explicitly specifies syncedAt or updatedAt, preserve them
      if (mods.syncedAt !== undefined || mods.updatedAt !== undefined) {
        return;
      }

      // Otherwise, it's a user modification: set updatedAt to now, and reset syncedAt to null
      return {
        ...mods,
        updatedAt: new Date(),
        syncedAt: null
      };
    });
  });

  // Track hard deletes in the deletedRecords tombstone table
  const hardDeleteTables = [
    'paymentMethods',
    'users',
    'transactions',
    'debts',
    'stockOpnames'
  ];

  hardDeleteTables.forEach((tableName) => {
    const table = db.table<Record<string, unknown>, number>(tableName);
    table.hook('deleting', (primKey, obj) => {
      setTimeout(() => {
        db.deletedRecords.add({
          tableName,
          recordId: primKey,
          deletedAt: new Date(),
          syncedAt: null
        }).catch((err) => {
          console.error(`Failed to record deletedRecord tombstone for ${tableName} (ID: ${primKey}):`, err);
        });
      }, 0);
    });
  });
}

// Seed role bawaan (ROLES-PERMISSIONS) — idempotent, hanya saat roles kosong.
export async function seedDefaultRoles() {
  const count = await db.roles.count();
  if (count > 0) return;
  const now = new Date();
  const salesId = await db.roles.add({
    name: 'Sales',
    permissions: ['create_transaction'],
    isBuiltIn: 1,
    isActive: 1,
    createdAt: now,
    syncedAt: null,
  });
  await db.roles.add({
    name: 'Admin',
    permissions: [...ALL_PERMISSIONS],
    isBuiltIn: 1,
    isActive: 1,
    createdAt: now,
    syncedAt: null,
  });
  // Map user staff existing (tanpa roleId) ke role Sales; permissions dipertahankan.
  await db.users.toCollection().modify((u) => {
    if (u.role === 'staff' && u.roleId === undefined) u.roleId = salesId as number;
  });
}

// Seed default data
export async function seedDefaultData() {
  await seedDefaultRoles();

  // Multi-toko (M0): pastikan entry registry toko default ada.
  const settings = await db.storeSettings.toCollection().first();
  await ensureDefaultStoreEntry(settings?.storeName);

  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    await db.categories.bulkAdd([
      { name: 'Makanan', color: '#FF6B35', icon: 'ðŸ•', createdAt: new Date(), isDeleted: 0, deletedAt: null },
      { name: 'Minuman', color: '#4ECDC4', icon: 'ðŸ¥¤', createdAt: new Date(), isDeleted: 0, deletedAt: null },
      { name: 'Lainnya', color: '#95A5A6', icon: 'ðŸ“¦', createdAt: new Date(), isDeleted: 0, deletedAt: null },
    ]);
  }

  const pmCount = await db.paymentMethods.count();
  if (pmCount === 0) {
    await db.paymentMethods.bulkAdd([
      { name: 'Tunai', category: 'tunai', isDefault: true, createdAt: new Date() },
      { name: 'Transfer Bank', category: 'transfer', isDefault: false, createdAt: new Date() },
      { name: 'QRIS', category: 'qris', isDefault: false, createdAt: new Date() },
    ]);
  }

  const unitCount = await db.units.count();
  if (unitCount === 0) {
    const now = new Date();
    await db.units.bulkAdd([
      { name: 'pcs',     isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'kg',      isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'gram',    isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'liter',   isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'ml',      isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'porsi',   isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'cup',     isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'botol',   isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'bungkus', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
    ]);
  }

  const storeCount = await db.storeSettings.count();
  if (storeCount === 0) {
    await db.storeSettings.add({
      storeName: 'Toko Saya',
      address: '',
      phone: '',
      receiptFooter: 'Terima kasih atas kunjungan Anda!',
      printLogo: false,
      onboardingDone: false,
      lastBackupAt: null,
      deviceId: crypto.randomUUID(),
    });
  } else {
    // Fallback: if storeSettings exists but has no deviceId, generate one
    const settings = await db.storeSettings.toCollection().first();
    if (settings && !settings.deviceId) {
      await db.storeSettings.update(settings.id!, { deviceId: crypto.randomUUID() });
    }
  }

  // Seed default expense categories (idempotent â€” runs only when empty)
  const expenseCatCount = await db.expenseCategories.count();
  if (expenseCatCount === 0) {
    const now = new Date();
    await db.expenseCategories.bulkAdd([
      { name: 'Listrik & Air',  color: '#FBBF24', icon: 'ðŸ’¡', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'Sewa',           color: '#8B5CF6', icon: 'ðŸ ', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'Gaji',           color: '#10B981', icon: 'ðŸ‘¤', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'Transport',      color: '#3B82F6', icon: 'ðŸšš', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'Operasional',    color: '#F97316', icon: 'ðŸ§°', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'Lainnya',        color: '#6B7280', icon: 'ðŸ“¦', isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
    ]);
  }

  // Sanitize any dates stored as string (e.g. from restored backup)
  await sanitizeDatabaseDates();
}
