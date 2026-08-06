// === Permission keys (CR-multiuser) ===
export type PermissionKey =
  | 'create_transaction'
  | 'delete_transaction'
  | 'manage_products'
  | 'manage_categories_payments'
  | 'manage_stock_inout'
  | 'manage_supplier'
  | 'manage_customers'
  | 'view_reports'
  | 'manage_backup'
  | 'manage_store_settings'
  | 'manage_expenses'
  | 'view_expenses';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'create_transaction',
  'delete_transaction',
  'manage_products',
  'manage_categories_payments',
  'manage_stock_inout',
  'manage_supplier',
  'manage_customers',
  'view_reports',
  'manage_backup',
  'manage_store_settings',
  'manage_expenses',
  'view_expenses',
];

// === Interfaces ===

export interface User {
  id?: number;
  username: string;       // unique, lowercase
  pinHash: string;        // SHA-256 hex
  name: string;           // display name
  role: 'owner' | 'staff';
  /** Referensi role (tabel roles) untuk staff. Owner/Administrator implicit all. */
  roleId?: number;
  /** 1 = permission user di-override manual (tidak ikut sync saat role berubah). */
  overrideRole?: number;
  permissions: PermissionKey[]; // owner ignores this (has all)
  isActive: number;       // 0/1 — IndexedDB can't index booleans
  createdAt: Date;
  lastLoginAt: Date | null;
  updatedAt?: Date;
  syncId?: string;         // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

/** Role bernama (ROLES-PERMISSIONS). Administrator = owner (implicit, tanpa baris). */
export interface Role {
  id?: number;
  name: string;                 // "Admin", "Sales", "Karyawan Toko", dll
  permissions: PermissionKey[]; // set hak akses
  isBuiltIn: number;            // 1 = bawaan (Admin/Sales), 0 = kustom
  isActive: number;             // 0/1
  createdAt: Date;
  updatedAt?: Date;
  syncId?: string;              // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;       // ikut sync cloud nanti
}

/** Kunci role bawaan. */
export const BUILTIN_ROLE_KEYS = {
  admin: 'Admin',
  sales: 'Sales',
} as const;

export interface Category {
  id?: number;
  name: string;
  color: string;
  icon: string;
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted (IndexedDB can't index booleans)
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface Product {
  id?: number;
  name: string;
  sku: string;
  categoryId: number;
  price: number; // harga jual
  hpp: number; // harga pokok penjualan
  stock: number;
  trackStock?: boolean; // true/undefined = stok dikelola (default lama), false = stok tidak dikelola (selalu tersedia)
  unit: string; // satuan: pcs, kg, liter, dll
  description?: string; // deskripsi/catatan produk (opsional, multi-line)
  photo?: string; // base64 or blob URL
  barcode?: string;
  /** Nilai kolom khusus sesuai jenis toko (PRODUCT-TYPES). Key mengikuti
   * definisi di src/lib/product-fields.ts; disimpan sebagai JSON. */
  attributes?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
  createdBy?: number; // userId (optional — undefined for legacy/single-user mode)
  updatedBy?: number; // userId
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface Supplier {
  id?: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface Customer {
  id?: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface StockIn {
  id?: number;
  productId: number;
  supplierId: number;
  quantity: number;
  buyPrice: number; // harga beli per unit
  totalPrice: number;
  date: Date;
  notes: string;
  createdBy?: number; // userId
  updatedAt?: Date;
  syncId?: string;          // UUID unik lintas perangkat (Phase A)
  productSyncId?: string;   // relasi dual ke products
  supplierSyncId?: string;  // relasi dual ke suppliers
  syncedAt?: Date | null;
}

export interface StockOut {
  id?: number;
  productId: number;
  quantity: number;
  reason: string; // rusak, hilang, retur, opname, dll
  date: Date;
  notes: string;
  createdBy?: number; // userId
  updatedAt?: Date;
  syncId?: string;        // UUID unik lintas perangkat (Phase A)
  productSyncId?: string; // relasi dual ke products
  syncedAt?: Date | null;
}

export interface StockOpname {
  id?: number;
  date: Date;
  status: 'draft' | 'completed';
  notes?: string;
  createdBy?: number; // userId
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface StockOpnameItem {
  id?: number;
  opnameId: number;
  productId: number;
  systemStock: number;
  realStock: number;
  difference: number;
  syncId?: string;         // UUID unik lintas perangkat (Phase A)
  opnameSyncId?: string;   // relasi dual ke stockOpnames
  productSyncId?: string;  // relasi dual ke products
}

export interface HppHistory {
  id?: number;
  productId: number;
  oldHpp: number;
  newHpp: number;
  source: 'stock_in' | 'manual';
  date: Date;
  updatedAt?: Date;
  syncId?: string;        // UUID unik lintas perangkat (Phase A)
  productSyncId?: string; // relasi dual ke products
  syncedAt?: Date | null;
}

export interface PaymentMethod {
  id?: number;
  name: string;
  category: string; // tunai, transfer, e-wallet, qris
  isDefault: boolean;
  createdAt: Date;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface Transaction {
  id?: number;
  subtotal: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  total: number;
  paymentMethodId: number;
  paymentAmount: number;
  change: number;
  profit: number;
  date: Date;
  receiptNumber: string;
  status: 'open' | 'completed';
  orderNumber?: string;
  customerId?: number; // relasi ke master pelanggan (opsional)
  customerName?: string; // snapshot nama saat transaksi (tahan terhadap edit/hapus master)
  tableNumber?: string;
  remarks?: string;
  openedAt?: Date;
  closedAt?: Date;
  createdBy?: number; // userId — kasir pembuat transaksi
  debtAmount?: number; // snapshot hutang awal; 0/undefined = lunas saat checkout
  updatedAt?: Date;
  syncId?: string;            // UUID unik lintas perangkat (Phase A)
  paymentMethodSyncId?: string; // relasi dual ke paymentMethods
  customerSyncId?: string;      // relasi dual ke customers
  syncedAt?: Date | null;
}

export interface TransactionItemRecord {
  id?: number;
  transactionId: number;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  hpp: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  notes?: string;
  syncId?: string;            // UUID unik lintas perangkat (Phase A)
  transactionSyncId?: string; // relasi dual ke transactions
  productSyncId?: string;     // relasi dual ke products
}

export interface Unit {
  id?: number;
  name: string; // satuan: pcs, kg, liter, dll
  isDefault: number; // 0 = user-added, 1 = seeded default
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface ExpenseCategory {
  id?: number;
  name: string;        // "Listrik", "Gaji", "Sewa", "Transport", dll
  color: string;       // hex
  icon: string;        // emoji
  isDefault: number;   // 0 = user-added, 1 = seeded default
  createdAt: Date;
  isDeleted: number;   // 0 = active, 1 = deleted
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

export interface Expense {
  id?: number;
  title: string;                   // "Bayar listrik bulan Mei"
  categoryId: number;              // FK -> expenseCategories
  amount: number;
  paymentMethodId: number;         // FK -> paymentMethods
  date: Date;                      // tanggal kejadian (cashflow basis)
  notes?: string;
  createdAt: Date;
  createdBy?: number;              // userId
  isDeleted: number;               // 0 = active, 1 = deleted
  deletedAt: Date | null;
  updatedAt?: Date;
  syncId?: string;            // UUID unik lintas perangkat (Phase A)
  categorySyncId?: string;    // relasi dual ke expenseCategories
  paymentMethodSyncId?: string; // relasi dual ke paymentMethods
  syncedAt?: Date | null;
}

export interface Debt {
  id?: number;
  transactionId: number;
  customerId: number;
  customerName: string;
  originalAmount: number;
  remainingAmount: number;
  status: 'unpaid' | 'partial' | 'paid';
  createdAt: Date;
  settledAt: Date | null;
  updatedAt?: Date;
  syncId?: string;            // UUID unik lintas perangkat (Phase A)
  transactionSyncId?: string; // relasi dual ke transactions
  customerSyncId?: string;    // relasi dual ke customers
  syncedAt?: Date | null;
}

export interface DebtPayment {
  id?: number;
  debtId: number;
  amount: number;
  paymentMethodId: number;
  date: Date;
  notes?: string;
  createdBy?: number;
  updatedAt?: Date;
  syncId?: string;            // UUID unik lintas perangkat (Phase A)
  debtSyncId?: string;        // relasi dual ke debts
  paymentMethodSyncId?: string; // relasi dual ke paymentMethods
  syncedAt?: Date | null;
}

export interface DeletedRecord {
  id?: number;
  tableName: string;
  recordId: number | string;
  /** syncId record yang dihapus (untuk tombstone lintas perangkat). */
  recordSyncId?: string;
  deletedAt: Date;
  syncedAt: Date | null;
}

/** Metadata sync lintas perangkat (Phase A M1/M2) — satu baris (id=1). */
export interface SyncMeta {
  id?: number;
  /** Kursor pull terakhir (ISO server time). */
  lastPullCursor: string | null;
  lastSyncAt: Date | null;
  /** Pesan error sync terakhir (UX: ditampilkan di CloudHub). */
  lastSyncError?: string | null;
  /** Jumlah konflik LWW yang ditimpa versi server pada pull terakhir. */
  lastConflictCount?: number;
}

/** Snapshot backup lokal otomatis (OFFLINE-BACKUP M0) — disimpan di IndexedDB. */
export interface LocalBackup {
  id?: number;
  createdAt: Date;
  /** Seluruh isi DB sebagai JSON string (buildBackupData). */
  data: string;
  sizeBytes: number;
  /** Total baris seluruh tabel saat snapshot (info + deteksi perubahan). */
  rowCount?: number;
  /** Nilai change-counter saat snapshot (OFFLINE-BACKUP M1, deteksi perubahan). */
  changeCounter?: number;
}

/** Shift kasir — buka/tutup kas, hitung selisih tunai (v2). */
export interface CashierShift {
  id?: number;
  userId: number | null;
  userName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  closingCash: number | null;
  /** Expected drawer cash at close (opening + cash in − cash out). */
  expectedCash: number | null;
  cashSales: number;
  cashExpenses: number;
  txCount: number;
  salesTotal: number;
  notes?: string;
  status: 'open' | 'closed';
  updatedAt?: Date;
  syncId?: string; // UUID unik lintas perangkat (Phase A)
  syncedAt?: Date | null;
}

/** Kolom khusus buatan user untuk jenis toko "Lainnya" (PRODUCT-TYPES). */
export interface StoreCustomField {
  key: string; // slug unik (mis. "warna")
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  required?: boolean;
  options?: string[]; // untuk type select
}

export interface StoreSettings {
  id?: number;
  storeName: string;
  address: string;
  phone: string;
  receiptFooter: string;
  onboardingDone: boolean;
  lastBackupAt: Date | null;
  themeColor?: string; // HSL hue string e.g. "25" for orange
  logo?: string; // base64 JPEG compressed via compressImage()
  deviceId: string;
  multiUserEnabled?: boolean; // CR-multiuser: opt-in flag
  seenWhatsNewIds?: string[]; // IDs of "What's New" features the user has dismissed
  cloudAutoBackupInterval?: 'off' | 'hourly' | 'daily' | 'weekly'; // auto cloud backup cadence (default off)
  cloudAutoBackupHours?: number; // interval jam bila cloudAutoBackupInterval === 'hourly'
  lastCloudBackupAt?: Date | null; // last successful upload to cloud
  /** Auto-backup lokal (OFFLINE-BACKUP M0): snapshot otomatis di IndexedDB. Default 'hourly' (on). */
  localAutoBackup?: 'off' | 'hourly' | 'daily';
  lastLocalBackupAt?: Date | null; // last successful local snapshot
  allowDebt?: boolean; // opt-in pembayaran sebagian/seluruhnya sebagai hutang
  cloudStoreId?: string | null; // cloud store ID yang di-bind ke device ini untuk sync
  printLogo?: boolean; // toggle to print store logo on ESC/POS receipt
  hideWatermark?: boolean; // toggle to hide Profitku.my.id credit/watermark on ESC/POS receipt
  /** Jenis toko (PRODUCT-TYPES): 'general' | 'shoes' | 'cosmetics' | 'other'. */
  storeType?: string;
  /** Custom fields untuk jenis toko "other" (opsional). */
  customFields?: StoreCustomField[];
}

// === Database ===
