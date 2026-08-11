
/**
 * Sinkronisasi lintas perangkat (Phase A M1/M2) — client pipeline.
 *
 * Model fail-closed: record lokal hanya ditandai tersinkron (`syncedAt`)
 * SETELAH server mengakui (ack) via push. Tidak ada penandaan optimis.
 *
 * v1: Last-Write-Wins per record berbasis `updatedAt` (server time).
 * Tombstone dikirim sebagai metadata (recordSyncId di deletedRecords).
 */

import { db, type PosDatabase } from '@/lib/db';
import { syncPush, syncPull, type SyncPushItem, type SyncTombstoneItem, type SyncPullResult } from '@/lib/cloud-api';

export const SYNC_TABLES = [
  'categories', 'products', 'suppliers', 'customers', 'stockIns', 'stockOuts',
  'hppHistory', 'stockLots', 'stockLotAllocations', 'paymentMethods', 'transactions', 'transactionItems', 'units',
  'users', 'roles', 'expenseCategories', 'expenses', 'debts', 'debtPayments',
  'stockOpnames', 'stockOpnameItems', 'cashierShifts',
] as const;

type AnyRow = Record<string, unknown> & {
  id?: number;
  syncId?: string;
  syncedAt?: Date | null;
  updatedAt?: Date | string;
  isDeleted?: number;
  deletedAt?: Date | null;
};

/** Resolusi FK lokal dari syncId parent saat menerapkan pull. */
const FK_RESOLVE: Record<string, [syncField: string, parentTable: string, localField: string][]> = {
  transactionItems: [['transactionSyncId', 'transactions', 'transactionId'], ['productSyncId', 'products', 'productId']],
  stockIns: [['productSyncId', 'products', 'productId'], ['supplierSyncId', 'suppliers', 'supplierId']],
  stockOuts: [['productSyncId', 'products', 'productId']],
  hppHistory: [['productSyncId', 'products', 'productId']],
  expenses: [['categorySyncId', 'expenseCategories', 'categoryId'], ['paymentMethodSyncId', 'paymentMethods', 'paymentMethodId']],
  debts: [['transactionSyncId', 'transactions', 'transactionId'], ['customerSyncId', 'customers', 'customerId']],
  debtPayments: [['debtSyncId', 'debts', 'debtId'], ['paymentMethodSyncId', 'paymentMethods', 'paymentMethodId']],
  stockOpnameItems: [['opnameSyncId', 'stockOpnames', 'opnameId'], ['productSyncId', 'products', 'productId']],
  stockLotAllocations: [
    ['stockLotSyncId', 'stockLots', 'stockLotId'],
    ['transactionSyncId', 'transactions', 'transactionId'],
    ['productSyncId', 'products', 'productId'],
  ],
};

export function toIso(value: Date | string | undefined): string {
  if (!value) return new Date(0).toISOString();
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? new Date(0).toISOString() : dt.toISOString();
}

/**
 * Kumpulkan record dirty (syncedAt kosong) + tombstone belum terkirim.
 * `id`, `syncId`, `syncedAt` tidak dikirim (id lokal tidak pernah lintas device).
 */
export async function collectPushPayload(target: PosDatabase = db): Promise<{
  records: Record<string, SyncPushItem[]>;
  tombstones: SyncTombstoneItem[];
}> {
  const records: Record<string, SyncPushItem[]> = {};
  for (const tableName of SYNC_TABLES) {
    const rows = await target
      .table<AnyRow, number>(tableName)
      .filter((r) => r.syncedAt === null || r.syncedAt === undefined)
      .toArray();
    if (rows.length === 0) continue;
    records[tableName] = rows.map((r) => {
      const { id: _id, syncId, syncedAt: _syncedAt, ...data } = r;
      return { syncId: r.syncId ?? '', data, updatedAt: toIso(r.updatedAt) };
    });
  }
  const tombstones = await target.deletedRecords.filter((r) => r.syncedAt === null && !!r.recordSyncId).toArray();
  return {
    records,
    tombstones: tombstones.map((r) => ({
      table: r.tableName,
      syncId: String(r.recordSyncId),
      deletedAt: toIso(r.deletedAt),
    })),
  };
}

/** Tandai record yang di-ack server sebagai tersinkron (fail-closed: hanya yang di-ack). */
export async function markSynced(
  payload: { records: Record<string, SyncPushItem[]>; tombstones: SyncTombstoneItem[] },
  accepted: string[],
  serverTime: string,
  target: PosDatabase = db,
): Promise<void> {
  const set = new Set(accepted);
  if (set.size === 0) return;
  const syncedAt = new Date(serverTime);
  for (const [tableName, items] of Object.entries(payload.records)) {
    const table = target.table<AnyRow, number>(tableName);
    for (const item of items) {
      if (!set.has(item.syncId)) continue;
      await table.filter((r) => r.syncId === item.syncId).modify({ syncedAt } as never);
    }
  }
  await target.deletedRecords
    .filter((r) => r.recordSyncId && set.has(String(r.recordSyncId)))
    .modify({ syncedAt } as never);
}

/** Resolve FK lokal dari syncId parent (cache per parent table). */
async function resolveFk(tableName: string, data: AnyRow, target: PosDatabase = db): Promise<void> {
  const specs = FK_RESOLVE[tableName];
  if (!specs) return;
  const cache = new Map<string, Map<string, number>>();
  for (const [syncField, parentTable, localField] of specs) {
    const syncId = data[syncField];
    if (!syncId) continue;
    let parentMap = cache.get(parentTable);
    if (!parentMap) {
      parentMap = new Map<string, number>();
      const rows = await target.table<AnyRow, number>(parentTable).toArray();
      for (const r of rows) {
        if (r.syncId && r.id != null) parentMap.set(String(r.syncId), r.id);
      }
      cache.set(parentTable, parentMap);
    }
    const localId = parentMap.get(String(syncId));
    if (localId != null) data[localField] = localId;
  }
}

/** Terapkan hasil pull (LWW) ke DB lokal. Mengembalikan jumlah konflik LWW. */
export async function applyPull(result: SyncPullResult, target: PosDatabase = db): Promise<number> {
  let conflicts = 0;
  for (const rec of result.records) {
    const serverTime = new Date(rec.updatedAt);
    const data = (rec.data ?? {}) as AnyRow;
    const table = target.table<AnyRow, number>(rec.table);
    const existing = await table.filter((r) => r.syncId === rec.syncId).first();

    if (existing) {
      const localMs = new Date(toIso(existing.updatedAt)).getTime();
      if (!Number.isNaN(localMs) && localMs >= serverTime.getTime()) continue; // lokal lebih baru
      await resolveFk(rec.table, data, target);
      await table.update(existing.id as number, {
        ...data,
        syncId: rec.syncId,
        updatedAt: serverTime,
        syncedAt: serverTime,
      } as never);
      conflicts++; // versi server lebih baru → menimpa lokal
    } else {
      await resolveFk(rec.table, data, target);
      await table.add({
        ...data,
        syncId: rec.syncId,
        updatedAt: serverTime,
        syncedAt: serverTime,
        createdAt: (data.createdAt as Date) ?? serverTime,
        isDeleted: (data.isDeleted as number) ?? 0,
        deletedAt: (data.deletedAt as Date | null) ?? null,
      } as never);
    }
  }

  for (const tomb of result.tombstones) {
    const table = target.table<AnyRow, number>(tomb.table);
    const existing = await table.filter((r) => r.syncId === tomb.syncId).first();
    if (!existing) continue;
    const deletedAt = new Date(tomb.deletedAt);
    const localMs = new Date(toIso(existing.updatedAt)).getTime();
    if (!Number.isNaN(localMs) && localMs > deletedAt.getTime()) continue; // lokal lebih baru
    if ('isDeleted' in existing) {
      await table.update(existing.id as number, {
        isDeleted: 1,
        deletedAt,
        updatedAt: deletedAt,
        syncedAt: deletedAt,
      } as never);
    } else {
      await table.delete(existing.id as number);
    }
    conflicts++;
  }
  return conflicts;
}

/** Push data dirty → tandai ack → pull → apply. Return ringkas untuk UI. */
export async function syncNow(target: PosDatabase = db): Promise<{
  ok: boolean;
  message: string;
  conflicts?: number;
}> {
  const settings = await target.storeSettings.toCollection().first();
  const storeId = settings?.cloudStoreId ?? null;
  if (!storeId) return { ok: false, message: 'Hubungkan toko ke cloud terlebih dahulu' };

  const existingMeta = await target.syncMeta.get(1);
  if (existingMeta?.initialSyncRequired) {
    return { ok: false, message: 'Pilih sumber data sebelum initial sync antar-device' };
  }

  const payload = await collectPushPayload(target);
  if (Object.keys(payload.records).length > 0 || payload.tombstones.length > 0) {
    try {
      const pushed = await syncPush(storeId, payload, settings.deviceId);
      await markSynced(payload, pushed.accepted, pushed.serverTime, target);
    } catch (err) {
      await recordSyncError(target, err);
      return { ok: false, message: err instanceof Error ? err.message : 'Push gagal' };
    }
  }

  try {
    const meta = await target.syncMeta.get(1);
    const since = meta?.lastPullCursor ?? new Date(0).toISOString();
    const pulled = await syncPull(storeId, since);
    const conflicts = await applyPull(pulled, target);
    await target.syncMeta.put({
      id: 1,
      lastPullCursor: pulled.serverTime,
      lastSyncAt: new Date(),
      lastSyncError: null,
      lastConflictCount: conflicts,
      initialSyncRequired: false,
    });
    return {
      ok: true,
      message: `${pulled.records.length + pulled.tombstones.length} perubahan dari cloud`,
      conflicts,
    };
  } catch (err) {
    await recordSyncError(target, err);
    return { ok: false, message: err instanceof Error ? err.message : 'Pull gagal' };
  }
}

/** Simpan pesan error sync terakhir ke syncMeta (UX: tampil di CloudHub). */
async function recordSyncError(target: PosDatabase, err: unknown): Promise<void> {
  try {
    const meta = await target.syncMeta.get(1);
    await target.syncMeta.put({
      ...meta,
      id: 1,
      lastSyncError: err instanceof Error ? err.message : String(err),
    });
  } catch {
    /* sinkronisasi meta bukan blocker */
  }
}

/** Hitung jumlah record dirty (syncedAt kosong) + tombstone belum terkirim. */
export async function countPendingChanges(target: PosDatabase = db): Promise<number> {
  let count = 0;
  for (const tableName of SYNC_TABLES) {
    count += await target
      .table<AnyRow, number>(tableName)
      .filter((r) => r.syncedAt === null || r.syncedAt === undefined)
      .count();
  }
  count += await target.deletedRecords.filter((r) => r.syncedAt === null && !!r.recordSyncId).count();
  return count;
}

/** Status sync ringkas untuk UI (CloudHub). */
export async function getSyncStatus(target: PosDatabase = db): Promise<{
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  lastConflictCount: number;
  dirtyCount: number;
}> {
  const meta = await target.syncMeta.get(1);
  return {
    lastSyncAt: meta?.lastSyncAt ?? null,
    lastSyncError: meta?.lastSyncError ?? null,
    lastConflictCount: meta?.lastConflictCount ?? 0,
    dirtyCount: await countPendingChanges(target),
  };
}

/**
 * Pemicu background sync. PWA tak punya daemon — dipanggil saat app dibuka /
 * saat online + toko terhubung. Fail-silent (tidak mengganggu UX).
 */
export function triggerBackgroundSync(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  void syncNow().catch((err) => console.warn('[sync] background gagal:', err));
}

let listenersReady = false;

/**
 * Daftarkan listener retry: kembali online / app kembali terlihat → coba sync.
 * Idempotent; aman dipanggil berkali-kali.
 */
export function initSyncListeners(): void {
  if (listenersReady || typeof window === 'undefined') return;
  listenersReady = true;
  window.addEventListener('online', () => triggerBackgroundSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerBackgroundSync();
  });
}
