import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  captureLocalBackup,
  listLocalBackups,
  restoreFromLocalBackup,
  getLatestLocalBackup,
  hasLocalDataChanged,
  localBackupIntervalMs,
  MAX_LOCAL_BACKUPS,
} from '@/lib/local-backup';

describe('backup lokal otomatis (OFFLINE-BACKUP M0)', () => {
  beforeEach(async () => {
    await db.localBackups.clear();
    await db.products.clear();
    await db.storeSettings.clear();
    await db.storeSettings.add({
      storeName: 'Test', address: '', phone: '', receiptFooter: '', printLogo: false,
      onboardingDone: true, lastBackupAt: null, deviceId: 'test-device',
    });
  });

  it('localBackupIntervalMs memetakan interval ke ms', () => {
    expect(localBackupIntervalMs('hourly')).toBe(60 * 60 * 1000);
    expect(localBackupIntervalMs('daily')).toBe(24 * 60 * 60 * 1000);
    expect(localBackupIntervalMs('off')).toBeNull();
    expect(localBackupIntervalMs(undefined)).toBeNull();
  });

  it('captureLocalBackup menyimpan snapshot JSON + ukuran + rowCount', async () => {
    await db.products.add({
      name: 'P', sku: 'S1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    const snap = await captureLocalBackup();
    expect(snap.id).toBeTruthy();
    expect(snap.sizeBytes).toBeGreaterThan(0);
    expect(snap.rowCount).toBeGreaterThanOrEqual(1);
    expect(typeof snap.changeCounter).toBe('number');
    const parsed = JSON.parse(snap.data) as { version?: number; products?: unknown[] };
    expect(parsed.version).toBeGreaterThan(0);
    expect(parsed.products?.length).toBe(1);
  });

  it('pruneLocalBackups mempertahankan maksimal MAX_LOCAL_BACKUPS snapshot', async () => {
    for (let i = 0; i < MAX_LOCAL_BACKUPS + 3; i++) {
      await captureLocalBackup();
    }
    const all = await listLocalBackups();
    expect(all.length).toBe(MAX_LOCAL_BACKUPS);
  });

  it('restoreFromLocalBackup memulihkan data', async () => {
    await db.products.add({
      name: 'Asli', sku: 'S-ORIG', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    const snap = await captureLocalBackup();
    await db.products.clear();
    expect(await db.products.count()).toBe(0);
    await restoreFromLocalBackup(snap.id as number);
    const restored = await db.products.toArray();
    expect(restored.length).toBe(1);
    expect(restored[0].name).toBe('Asli');
  });

  it('hasLocalDataChanged mendeteksi perubahan data', async () => {
    expect(await hasLocalDataChanged()).toBe(true); // belum ada snapshot
    await captureLocalBackup();
    expect(await hasLocalDataChanged()).toBe(false); // belum ada perubahan
    await db.products.add({
      name: 'Baru', sku: 'S-NEW', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    expect(await hasLocalDataChanged()).toBe(true); // ada perubahan
  });

  it('hasLocalDataChanged memakai change-counter (edit in-place terdeteksi)', async () => {
    await db.products.add({
      name: 'A', sku: 'S-EDIT', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      createdAt: new Date(), updatedAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    await captureLocalBackup();
    expect(await hasLocalDataChanged()).toBe(false);
    // Edit in-place tanpa mengubah jumlah baris → tetap terdeteksi via counter.
    const p = await db.products.toCollection().first();
    await db.products.update(p!.id as number, { name: 'A2', updatedAt: new Date(), syncedAt: null } as never);
    expect(await hasLocalDataChanged()).toBe(true);
  });

  it('getLatestLocalBackup mengembalikan snapshot terbaru', async () => {
    await captureLocalBackup();
    const first = await getLatestLocalBackup();
    await new Promise((r) => setTimeout(r, 5));
    await captureLocalBackup();
    const latest = await getLatestLocalBackup();
    expect(latest?.id).not.toBe(first?.id);
    expect(latest!.createdAt.getTime()).toBeGreaterThanOrEqual(first!.createdAt.getTime());
  });
});
