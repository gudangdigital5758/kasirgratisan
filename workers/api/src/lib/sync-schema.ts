/**
 * Skema & limit payload sync (CLOUD-008).
 * Allowlist field per tabel: hanya field yang dikenal yang boleh disimpan ke
 * sync_records. Field sensitif (users.pinHash, dll.) sengaja tidak ada di daftar.
 */

export const SYNC_MAX_BYTES = 5 * 1024 * 1024;
export const SYNC_MAX_STRING_LEN = 200_000;
export const SYNC_MAX_PHOTO_LEN = 512 * 1024;
export const SYNC_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SYNC_FIELD_ALLOWLIST: Record<string, string[]> = {
  categories: ['name', 'color', 'icon', 'createdAt', 'isDeleted', 'deletedAt', 'updatedAt'],
  products: [
    'name', 'sku', 'categoryId', 'price', 'hpp', 'stock', 'trackStock', 'unit',
    'description', 'photo', 'barcode', 'attributes', 'createdAt', 'updatedAt',
    'isDeleted', 'deletedAt', 'createdBy', 'updatedBy',
  ],
  suppliers: ['name', 'phone', 'address', 'notes', 'createdAt', 'isDeleted', 'deletedAt', 'updatedAt'],
  customers: ['name', 'phone', 'email', 'address', 'notes', 'createdAt', 'isDeleted', 'deletedAt', 'updatedAt'],
  stockIns: [
    'productId', 'supplierId', 'productSyncId', 'supplierSyncId', 'quantity', 'buyPrice',
    'totalPrice', 'date', 'notes', 'createdBy', 'updatedAt',
  ],
  stockOuts: ['productId', 'productSyncId', 'quantity', 'reason', 'date', 'notes', 'createdBy', 'updatedAt'],
  hppHistory: ['productId', 'productSyncId', 'oldHpp', 'newHpp', 'source', 'date', 'updatedAt'],
  stockLots: [
    'productId', 'productSyncId', 'quantity', 'quantityRemaining', 'unitCost', 'date', 'source',
    'stockInId', 'stockOutId', 'updatedAt',
  ],
  stockLotAllocations: [
    'stockLotId', 'stockLotSyncId', 'transactionItemId', 'transactionId', 'transactionSyncId',
    'productId', 'productSyncId', 'quantity', 'costAmount',
  ],
  paymentMethods: ['name', 'category', 'isDefault', 'createdAt', 'updatedAt'],
  transactions: [
    'subtotal', 'discountType', 'discountValue', 'discountAmount', 'total', 'paymentMethodId',
    'paymentAmount', 'change', 'profit', 'date', 'receiptNumber', 'status', 'orderNumber',
    'customerId', 'customerSyncId', 'paymentMethodSyncId', 'customerName', 'tableNumber',
    'remarks', 'openedAt', 'closedAt', 'createdBy', 'debtAmount', 'updatedAt',
  ],
  transactionItems: [
    'transactionId', 'transactionSyncId', 'productId', 'productSyncId', 'productName',
    'quantity', 'price', 'hpp', 'costAmount', 'discountType', 'discountValue',
    'discountAmount', 'subtotal', 'notes',
  ],
  units: ['name', 'isDefault', 'createdAt', 'isDeleted', 'deletedAt', 'updatedAt'],
  // users: pinHash sengaja TIDAK ada di daftar (CLOUD-005).
  users: [
    'username', 'name', 'role', 'roleId', 'overrideRole', 'permissions', 'isActive',
    'createdAt', 'lastLoginAt', 'updatedAt',
  ],
  roles: ['name', 'permissions', 'isBuiltIn', 'isActive', 'createdAt', 'updatedAt'],
  expenseCategories: ['name', 'color', 'icon', 'isDefault', 'createdAt', 'isDeleted', 'deletedAt', 'updatedAt'],
  expenses: [
    'title', 'categoryId', 'categorySyncId', 'amount', 'paymentMethodId', 'paymentMethodSyncId',
    'date', 'notes', 'createdAt', 'createdBy', 'isDeleted', 'deletedAt', 'updatedAt',
  ],
  debts: [
    'transactionId', 'transactionSyncId', 'customerId', 'customerSyncId', 'customerName',
    'originalAmount', 'remainingAmount', 'status', 'createdAt', 'settledAt', 'updatedAt',
  ],
  debtPayments: [
    'debtId', 'debtSyncId', 'amount', 'paymentMethodId', 'paymentMethodSyncId', 'date',
    'notes', 'createdBy', 'updatedAt',
  ],
  stockOpnames: ['date', 'status', 'notes', 'createdBy', 'updatedAt'],
  stockOpnameItems: [
    'opnameId', 'opnameSyncId', 'productId', 'productSyncId', 'systemStock', 'realStock', 'difference',
  ],
  cashierShifts: [
    'userId', 'userName', 'openedAt', 'closedAt', 'openingCash', 'closingCash',
    'expectedCash', 'cashSales', 'cashExpenses', 'txCount', 'salesTotal', 'notes',
    'status', 'updatedAt',
  ],
};

/** Saring data record sesuai allowlist; nilai string terlalu panjang ditolak via throw. */
export function sanitizeSyncData(table: string, raw: unknown): Record<string, unknown> {
  const allowlist = SYNC_FIELD_ALLOWLIST[table] ?? [];
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!allowlist.includes(key)) continue;
      if (typeof value === 'string') {
        const len = new TextEncoder().encode(value).byteLength;
        if (key === 'photo') {
          if (len > SYNC_MAX_PHOTO_LEN) {
            throw new Error(`Field ${table}.${key} terlalu besar (maks 512 KB)`);
          }
        } else if (len > SYNC_MAX_STRING_LEN) {
          throw new Error(`Field ${table}.${key} terlalu panjang`);
        }
      }
      out[key] = value;
    }
  }
  return out;
}
