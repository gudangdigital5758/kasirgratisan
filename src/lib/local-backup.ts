import { db, type PosDatabase } from '@/lib/db';
import { buildBackupData, restoreFromBackupData, type BackupData } from '@/lib/backup';
import type { LocalBackup } from '@/lib/db-schema';
import { getChangeCounter } from './change-counter';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/**
 * Backup lokal otomatis (OFFLINE-BACKUP M0).
 *
 * Snapshot seluruh isi DB disimpan sebagai JSON string di tabel `localBackups`
 * (IndexedDB yang sama). Ini jaring pengaman untuk user awam: melindungi dari
 * kerusakan data / restore salah — TANPA internet dan TANPA izin apa pun.
 *
 * Catatan: snapshot lokal BUKAN backup fisik — hilang bila data browser/HP
 * dihapus. Untuk itu tetap ada backup file (export) & backup cloud.
 */

/** Jumlah snapshot lokal maksimal yang disimpan (rolling window). */
export const MAX_LOCAL_BACKUPS = 5;

/** Jumlah file fisik maksimal di penyimpanan perangkat (M2, rolling). */
export const MAX_LOCAL_FILES = 5;

/** Folder file fisik di penyimpanan perangkat (dokumen publik). */
export const LOCAL_FILE_DIR = 'Profitku-backups';

type LocalInterval = 'off' | 'hourly' | 'daily';

/** Interval snapshot dalam ms; null bila nonaktif. */
export function localBackupIntervalMs(interval: LocalInterval | undefined): number | null {
  switch (interval) {
    case 'hourly':
      return 60 * 60 * 1000;
    case 'daily':
      return 24 * 60 * 60 * 1000;
    default:
      return null; // 'off' / undefined
  }
}

/** Hitung total baris seluruh tabel (untuk info + deteksi perubahan ringan). */
function countRows(data: BackupData): number {
  return Object.values(data).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
}

/**
 * Buat snapshot baru seluruh DB → tabel localBackups, lalu prune rolling.
 * Mengembalikan record yang tersimpan (dengan id).
 */
export async function captureLocalBackup(target: PosDatabase = db): Promise<LocalBackup> {
  const data = await buildBackupData(target);
  const json = JSON.stringify(data);
  const sizeBytes = new Blob([json]).size;
  const createdAt = new Date();
  const rowCount = countRows(data);
  // Guard ukuran (M1): snapshot sangat besar tidak diblokir, hanya dicatat.
  if (sizeBytes > 50 * 1024 * 1024) {
    console.warn(`[local-backup] snapshot besar: ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`);
  }
  const id = await target.localBackups.add({ createdAt, data: json, sizeBytes, rowCount, changeCounter: getChangeCounter() });
  await pruneLocalBackups(target);
  return { id, createdAt, data: json, sizeBytes, rowCount, changeCounter: getChangeCounter() };
}

/** Hapus snapshot tertua sampai tersisa maksimal `keep` (rolling window). */
export async function pruneLocalBackups(target: PosDatabase = db, keep: number = MAX_LOCAL_BACKUPS): Promise<void> {
  const all = await target.localBackups.orderBy('createdAt').toArray();
  const excess = all.length - keep;
  if (excess <= 0) return;
  const toDelete = all.slice(0, excess);
  await target.localBackups.bulkDelete(toDelete.map((b) => b.id as number));
}

/** Daftar snapshot, terbaru duluan. */
export async function listLocalBackups(target: PosDatabase = db): Promise<LocalBackup[]> {
  return target.localBackups.orderBy('createdAt').reverse().toArray();
}

/** Snapshot terbaru, atau undefined bila belum ada. */
export async function getLatestLocalBackup(target: PosDatabase = db): Promise<LocalBackup | undefined> {
  return target.localBackups.orderBy('createdAt').last();
}

/**
 * Pulihkan data dari snapshot. Memakai restoreFromBackupData (snapshot +
 * rollback otomatis bila gagal). Snapshot lokal sendiri tidak ikut ter-reset.
 */
export async function restoreFromLocalBackup(id: number, target: PosDatabase = db): Promise<void> {
  const rec = await target.localBackups.get(id);
  if (!rec) throw new Error('Snapshot tidak ditemukan');
  await restoreFromBackupData(JSON.parse(rec.data) as BackupData);
}

/** Hapus satu snapshot. */
export async function deleteLocalBackup(id: number, target: PosDatabase = db): Promise<void> {
  await target.localBackups.delete(id);
}

/**
 * Deteksi perubahan (M1): bandingkan change-counter (dinaikkan setiap mutasi
 * data via setupSyncHooks) dengan nilai saat snapshot terakhir diambil.
 * Tanpa snapshot → dianggap berubah (perlu dibuat).
 */
export async function hasLocalDataChanged(target: PosDatabase = db): Promise<boolean> {
  const latest = await getLatestLocalBackup(target);
  if (!latest) return true; // belum ada snapshot → perlu dibuat
  return getChangeCounter() !== (latest.changeCounter ?? 0);
}

/**
 * Tulis snapshot terbaru sebagai FILE fisik di penyimpanan perangkat (M2).
 * Hanya berjalan di Android native (Capacitor) — di web auto-download diblokir
 * browser tanpa gesture user. Rolling: maksimal MAX_LOCAL_FILES file, yang lama
 * dihapus. Mengembalikan true bila berhasil menulis file.
 */
export async function exportLocalSnapshotToDevice(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false; // web: no-op
  const latest = await getLatestLocalBackup();
  if (!latest) return false;
  try {
    await Filesystem.mkdir({ path: LOCAL_FILE_DIR, directory: Directory.Documents, recursive: true }).catch(() => undefined);
    const fileName = `profitku-backup-${new Date(latest.createdAt).toISOString().slice(0, 10)}.json`;
    const entries = await Filesystem.readdir({ path: LOCAL_FILE_DIR, directory: Directory.Documents }).catch(() => ({ files: [] as { name: string; type: string }[] }));
    const jsonFiles = (entries?.files ?? [])
      .filter((f) => f.name.startsWith('profitku-backup-') && f.name.endsWith('.json'))
      .sort();
    while (jsonFiles.length >= MAX_LOCAL_FILES) {
      const oldest = jsonFiles.shift();
      if (!oldest) break;
      await Filesystem.deleteFile({ path: `${LOCAL_FILE_DIR}/${oldest.name}`, directory: Directory.Documents }).catch(() => undefined);
    }
    await Filesystem.writeFile({
      path: `${LOCAL_FILE_DIR}/${fileName}`,
      data: latest.data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return true;
  } catch (err) {
    console.warn('[local-backup] export file fisik gagal:', err);
    return false;
  }
}
