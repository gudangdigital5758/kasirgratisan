
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
import { syncPush, syncPull, CloudApiError, type SyncPushItem, type SyncTombstoneItem, type SyncPullRecord, type SyncPullResult, type SyncWinner } from '@/lib/cloud-api';
import { captureLocalBackup } from '@/lib/local-backup';

export const SYNC_TABLES = [
  'categories', 'products', 'suppliers', 'customers', 'stockIns', 'stockOuts',
  'hppHistory', 'stockLots', 'stockLotAllocations', 'paymentMethods', 'transactions', 'transactionItems', 'units',
  'users', 'roles', 'expenseCategories', 'expenses', 'debts', 'debtPayments',
  'stockOpnames', 'stockOpnameItems', 'cashierShifts',
] as const;

const INITIAL_SYNC_TABLES = SYNC_TABLES.filter((tableName) => tableName !== 'users');

type AnyRow = Record<string, unknown> & {
  id?: number;
  syncId?: string;
  syncedAt?: Date | null;
  updatedAt?: Date | string;
  isDeleted?: number;
  deletedAt?: Date | null;
};

/** Field sensitif yang TIDAK boleh dikirim ke cloud (CLOUD-005). */
const SENSITIVE_FIELDS: Record<string, string[]> = {
  users: ['pinHash'],
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

const PULLED_DATE_FIELDS: Record<string, string[]> = {
  categories: ['createdAt', 'deletedAt', 'updatedAt'],
  products: ['createdAt', 'updatedAt', 'deletedAt'],
  suppliers: ['createdAt', 'deletedAt', 'updatedAt'],
  customers: ['createdAt', 'deletedAt', 'updatedAt'],
  stockIns: ['date', 'updatedAt'],
  stockOuts: ['date', 'updatedAt'],
  hppHistory: ['date', 'updatedAt'],
  stockLots: ['date', 'updatedAt'],
  paymentMethods: ['createdAt', 'updatedAt'],
  transactions: ['date', 'openedAt', 'closedAt', 'updatedAt'],
  transactionItems: ['updatedAt'],
  units: ['createdAt', 'deletedAt', 'updatedAt'],
  users: ['createdAt', 'lastLoginAt', 'updatedAt'],
  roles: ['createdAt', 'updatedAt'],
  expenseCategories: ['createdAt', 'deletedAt', 'updatedAt'],
  expenses: ['date', 'createdAt', 'deletedAt', 'updatedAt'],
  debts: ['createdAt', 'settledAt', 'updatedAt'],
  debtPayments: ['date', 'updatedAt'],
  stockOpnames: ['date', 'updatedAt'],
  stockOpnameItems: ['updatedAt'],
  cashierShifts: ['openedAt', 'closedAt', 'updatedAt'],
};

function normalizePulledDates(tableName: string, data: AnyRow): void {
  for (const field of PULLED_DATE_FIELDS[tableName] ?? []) {
    const value = data[field];
    if (typeof value !== 'string') continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) data[field] = parsed;
  }
}

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
      for (const field of SENSITIVE_FIELDS[tableName] ?? []) {
        delete data[field];
      }
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
      const current = await table.filter((r) => r.syncId === item.syncId).toArray();
      for (const row of current) {
        // An edit may happen while the request is in flight. Do not mark the
        // newer local version as synced by an older queued acknowledgement.
        if (toIso(row.updatedAt) !== item.updatedAt) continue;
        await table.update(row.id as number, { syncedAt } as never);
      }
    }
  }
  const currentTombstones = await target.deletedRecords
    .filter((r) => r.recordSyncId && set.has(String(r.recordSyncId)))
    .toArray();
  for (const tombstone of currentTombstones) {
    const payloadTombstone = payload.tombstones.find(
      (item) => item.syncId === String(tombstone.recordSyncId),
    );
    if (payloadTombstone && toIso(tombstone.deletedAt) === payloadTombstone.deletedAt) {
      await target.deletedRecords.update(tombstone.id as number, { syncedAt });
    }
  }
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
  // Include every sync table because resolveFk() may read a parent that is
  // not present in this particular pull batch. A fixed tuple is required by
  // Dexie's transaction overloads.
  const transactionTables = [
    target.categories,
    target.products,
    target.suppliers,
    target.customers,
    target.stockIns,
    target.stockOuts,
    target.hppHistory,
    target.stockLots,
    target.stockLotAllocations,
    target.paymentMethods,
    target.transactions,
    target.transactionItems,
    target.units,
    target.users,
    target.roles,
    target.expenseCategories,
    target.expenses,
    target.debts,
    target.debtPayments,
    target.stockOpnames,
    target.stockOpnameItems,
    target.cashierShifts,
    target.deletedRecords,
  ] as const;

  return target.transaction('rw', transactionTables, async () => {
    let conflicts = 0;
    for (const rec of result.records) {
    const serverTime = new Date(rec.updatedAt);
    const data = (rec.data ?? {}) as AnyRow;
    normalizePulledDates(rec.table, data);
    // User PIN adalah device-local credential. Worker payload sengaja tidak
    // membawa pinHash, jadi jangan menimpa atau membuat user lokal tanpa PIN.
    if (rec.table === 'users' && !('pinHash' in data)) continue;
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
    if (tomb.table === 'users') continue;
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
  });
}

/** Maksimal batch pull dalam satu siklus syncNow (proteksi infinite loop). */
const PULL_MAX_BATCHES = 200;

/** Lock per storeId agar push/pull tidak overlap (CLOUD-009). */
const syncInFlight = new Map<string, Promise<unknown>>();

/** Push data dirty → tandai ack → pull (paginasi) → apply. Return ringkas untuk UI. */
export async function syncNow(target: PosDatabase = db): Promise<{
  ok: boolean;
  message: string;
  conflicts?: number;
}> {
  const settings = await target.storeSettings.toCollection().first();
  const storeId = settings?.cloudStoreId ?? null;
  if (!storeId) return { ok: false, message: 'Hubungkan toko ke cloud terlebih dahulu' };

  if (syncInFlight.has(storeId)) {
    return { ok: false, message: 'Sinkronisasi sedang berjalan di perangkat ini' };
  }

  // Reserve the lock before the first await after the check. Without this
  // placeholder promise, two callers could both pass the check while waiting
  // for syncMeta.get() and then start concurrent push/pull cycles.
  let releaseLock!: () => void;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  syncInFlight.set(storeId, lock);

  try {
    const existingMeta = await target.syncMeta.get(1);
    if (existingMeta?.initialSyncRequired) {
      return { ok: false, message: 'Pilih sumber data sebelum initial sync antar-device' };
    }

    const task = (async () => {
    const queuedResult = await flushQueuedBatch(target, storeId, settings.deviceId);
    if (!queuedResult.ok) {
      await recordSyncError(target, queuedResult.message || 'Queue sync belum selesai');
      return { ok: false, message: queuedResult.message || 'Queue sync belum selesai' };
    }
    let pushConflicts = queuedResult.conflicts ?? 0;

    const payload = await collectPushPayload(target);
    if (Object.keys(payload.records).length > 0 || payload.tombstones.length > 0) {
      try {
        const pushed = await syncPush(storeId, payload, settings.deviceId);
        await markSynced(payload, pushed.accepted, pushed.serverTime, target);
        if (pushed.winners?.length) {
          pushConflicts += await applyPushWinners(pushed.winners, target);
        }
      } catch (err) {
        if (isRetryablePushError(err)) {
          await enqueuePushBatch(target, storeId, payload, err);
        }
        await recordSyncError(target, err);
        return { ok: false, message: err instanceof Error ? err.message : 'Push gagal' };
      }
    }

    try {
      const meta = await target.syncMeta.get(1);
      // CLOUD-004: pull berjalan multi-batch dengan keyset cursor "ISO|id".
      // Cursor hanya disimpan setelah seluruh batch sukses diterapkan.
      const since = meta?.lastPullCursor ?? new Date(0).toISOString();
      const records: SyncPullRecord[] = [];
      const tombstones: SyncTombstoneItem[] = [];
      let serverTime = '';
      let cursor = since;
      let batches = 0;
      let hasMore = true;
      while (hasMore && batches < PULL_MAX_BATCHES) {
        const res: SyncPullResult = await syncPull(storeId, cursor);
        records.push(...res.records);
        tombstones.push(...res.tombstones);
        serverTime = res.serverTime;
        cursor = res.nextCursor ?? res.cursor ?? res.serverTime;
        hasMore = !!res.hasMore;
        batches++;
        if (!res.nextCursor) break; // worker baru: berhenti bila batch terakhir
      }

      const conflicts = pushConflicts + await applyPull({ records, tombstones, serverTime }, target);
      await target.syncMeta.put({
        id: 1,
        lastPullCursor: cursor,
        lastSyncAt: new Date(),
        lastSyncError: null,
        lastConflictCount: conflicts,
        initialSyncRequired: false,
      });
      return {
        ok: true,
        message: `${records.length + tombstones.length} perubahan dari cloud`,
        conflicts,
      };
    } catch (err) {
      await recordSyncError(target, err);
      return { ok: false, message: err instanceof Error ? err.message : 'Pull gagal' };
    }
    })();
    return await task;
  } finally {
    releaseLock();
    syncInFlight.delete(storeId);
  }
}

type PushPayload = { records: Record<string, SyncPushItem[]>; tombstones: SyncTombstoneItem[] };

async function applyPushWinners(winners: SyncWinner[], target: PosDatabase): Promise<number> {
  return applyPull({
    records: winners
      .filter((winner) => !winner.deleted)
      .map(({ table, syncId, data, updatedAt }) => ({ table, syncId, data, updatedAt })),
    tombstones: winners
      .filter((winner) => winner.deleted)
      .map(({ table, syncId, deletedAt, updatedAt }) => ({
        table,
        syncId,
        deletedAt: deletedAt ?? updatedAt,
      })),
    serverTime: new Date().toISOString(),
  }, target);
}

function isRetryablePushError(err: unknown): boolean {
  if (!(err instanceof CloudApiError)) return true;
  // Invalid payload, auth, entitlement, and quota errors need user action;
  // retry network/server/rate-limit failures via the persistent queue.
  return err.status === 408 || err.status === 429 || err.status >= 500;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.min(attempts, 10) * 1000));
}

async function enqueuePushBatch(
  target: PosDatabase,
  storeId: string,
  payload: PushPayload,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date();
  await target.syncQueue.add({
    storeId,
    createdAt: now,
    payload: JSON.stringify(payload),
    attempts: 1,
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(1)),
    lastError: message,
  });
}

/** Retry one due batch. Returns false when the current sync must stop. */
async function flushQueuedBatch(
  target: PosDatabase,
  storeId: string,
  deviceId: string,
): Promise<{ ok: boolean; message?: string; conflicts?: number }> {
  const now = Date.now();
  const queued = await target.syncQueue.where('storeId').equals(storeId).toArray();
  const batch = queued
    .filter((item) => item.nextAttemptAt.getTime() <= now)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (!batch) {
    const waiting = queued.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
    if (waiting) return { ok: false, message: waiting.lastError || 'Menunggu retry sync berikutnya' };
    return { ok: true };
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(batch.payload) as PushPayload;
  } catch {
    await target.syncQueue.delete(batch.id as number);
    return { ok: false, message: 'Queue sync rusak dan telah dibuang' };
  }

  try {
    const pushed = await syncPush(storeId, payload, deviceId);
    await markSynced(payload, pushed.accepted, pushed.serverTime, target);
    const conflicts = pushed.winners?.length ? await applyPushWinners(pushed.winners, target) : 0;
    await target.syncQueue.delete(batch.id as number);
    return { ok: true, conflicts };
  } catch (err) {
    const attempts = batch.attempts + 1;
    const retryable = isRetryablePushError(err);
    await target.syncQueue.update(batch.id as number, {
      attempts,
      nextAttemptAt: new Date(Date.now() + (retryable ? retryDelayMs(attempts) : 24 * 60 * 60 * 1000)),
      lastError: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: err instanceof Error ? err.message : 'Retry push gagal' };
  }
}

export type InitialSyncChoice = 'cloud' | 'local';

/**
 * Selesaikan initial sync yang sebelumnya diblokir oleh `initialSyncRequired`.
 * Selalu membuat snapshot lokal sebelum operasi destructive/merge.
 */
export async function resolveInitialSync(
  choice: InitialSyncChoice,
  target: PosDatabase = db,
): Promise<{ ok: boolean; message: string; conflicts?: number }> {
  await captureLocalBackup(target);
  await target.syncQueue.clear();

  if (choice === 'cloud') {
    for (const tableName of INITIAL_SYNC_TABLES) {
      await target.table<AnyRow, number>(tableName).clear();
    }
    await target.deletedRecords.clear();
  } else {
    const now = new Date();
    for (const tableName of INITIAL_SYNC_TABLES) {
      await target.table<AnyRow, number>(tableName).toCollection().modify((row) => {
        row.updatedAt = now;
        row.syncedAt = null;
      });
    }
    await target.deletedRecords
      .filter((row) => !!row.recordSyncId)
      .modify({ syncedAt: null });
  }

  await target.syncMeta.put({
    id: 1,
    lastPullCursor: null,
    lastSyncAt: null,
    lastSyncError: null,
    lastConflictCount: 0,
    initialSyncRequired: false,
  });
  return syncNow(target);
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

/**
 * Apakah DB lokal sudah memiliki data yang berisiko tercampur saat direct bind
 * ke cloud store lain? Dipakai UI sebagai safety gate sebelum binding tanpa
 * initial-sync wizard (CLOUD-002/CLOUD-006).
 */
export async function hasLocalSyncData(target: PosDatabase = db): Promise<boolean> {
  const counts = await Promise.all([
    target.products.count(),
    target.transactions.count(),
    target.transactionItems.count(),
    target.stockLots.count(),
    target.stockOpnames.count(),
  ]);
  return counts.some((count) => count > 0);
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
