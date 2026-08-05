import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { captureLocalBackup, exportLocalSnapshotToDevice, hasLocalDataChanged, localBackupIntervalMs } from '@/lib/local-backup';

const CHECK_MS = 60 * 1000; // cek berkala tiap 1 menit selama app terbuka

/**
 * Auto-backup lokal (OFFLINE-BACKUP M0): snapshot otomatis ke IndexedDB.
 *
 * - Default AKTIF ('hourly') untuk user awam — tidak perlu setting apa pun.
 * - PWA tidak punya background daemon: snapshot diambil saat app dibuka dan
 *   dicek tiap menit selama app terbuka (hanya bila sudah lewat interval &
 *   ada perubahan data). Gagal = silent (jangan ganggu UX).
 */
export function useLocalAutoBackup() {
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const busyRef = useRef(false);

  useEffect(() => {
    if (!storeSettings) return;

    const run = async () => {
      if (busyRef.current) return;
      const settings = await db.storeSettings.toCollection().first();
      if (!settings) return;
      const ms = localBackupIntervalMs(settings.localAutoBackup ?? 'hourly'); // default ON
      if (ms === null) return;
      const last = settings.lastLocalBackupAt ? new Date(settings.lastLocalBackupAt).getTime() : 0;
      if (Date.now() - last < ms) return;
      // Skip snapshot bila tidak ada perubahan data (hemat penyimpanan).
      let changed = true;
      try {
        changed = await hasLocalDataChanged();
      } catch {
        changed = true;
      }
      if (!changed) return;
      busyRef.current = true;
      try {
        await captureLocalBackup();
        // M2: di Android, snapshot juga ditulis sebagai file fisik (rolling).
        await exportLocalSnapshotToDevice();
        if (settings.id) {
          await db.storeSettings.update(settings.id, { lastLocalBackupAt: new Date() });
        }
      } catch (err) {
        console.warn('[local-backup] snapshot otomatis gagal:', err);
      } finally {
        busyRef.current = false;
      }
    };

    void run();
    const timer = window.setInterval(run, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [storeSettings]);
}
