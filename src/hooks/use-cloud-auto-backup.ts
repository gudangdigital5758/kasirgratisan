import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { buildBackupJsonString, backupFileName } from '@/lib/backup';
import { uploadBackup, CloudApiError } from '@/lib/cloud-api';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { toast } from 'sonner';

const HOUR_MS = 60 * 60 * 1000;

/** Interval auto-backup dalam ms; null bila nonaktif/invalid. */
function intervalMs(
  interval: 'off' | 'hourly' | 'daily' | 'weekly' | undefined,
  hours: number | undefined,
): number | null {
  switch (interval) {
    case 'hourly':
      return hours && hours >= 1 ? hours * HOUR_MS : null;
    case 'daily':
      return 24 * HOUR_MS;
    case 'weekly':
      return 7 * 24 * HOUR_MS;
    default:
      return null;
  }
}

/**
 * Menjalankan auto-backup ke cloud saat app dibuka, bila:
 *  - user sudah login Google & punya langganan aktif,
 *  - interval auto-backup di-set (daily/weekly),
 *  - sudah lewat dari interval sejak backup cloud terakhir.
 *
 * PWA/WebView tidak punya background daemon, jadi pengecekan terjadi sekali
 * tiap app dibuka (saat kondisi siap), dijaga ref agar tidak dobel.
 */
export function useCloudAutoBackup() {
  const { isLoggedIn, isSubscribed, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!storeSettings) return;
    if (!isLoggedIn || !isSubscribed) return;

    const ms = intervalMs(storeSettings.cloudAutoBackupInterval, storeSettings.cloudAutoBackupHours);
    if (ms === null) return;

    const last = storeSettings.lastCloudBackupAt ? new Date(storeSettings.lastCloudBackupAt).getTime() : 0;
    const due = Date.now() - last >= ms;
    if (!due) return;

    ranRef.current = true; // tandai sudah jalan untuk sesi ini

    (async () => {
      try {
        const json = await buildBackupJsonString();
        await uploadBackup(json, backupFileName());
        if (storeSettings.id) {
          await db.storeSettings.update(storeSettings.id, { lastCloudBackupAt: new Date() });
        }
        await refreshProfile();
        toast.success('Backup otomatis ke cloud berhasil');
      } catch (err) {
        if (err instanceof CloudApiError && err.status === 400) {
          toast.error('Auto-backup gagal: kuota cloud penuh. Hapus backup lama atau upgrade paket.');
        } else {
          console.warn('[auto-backup] gagal:', err);
        }
      }
    })();
  }, [storeSettings, isLoggedIn, isSubscribed, refreshProfile]);
}
