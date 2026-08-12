import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { buildCloudBackupJsonString, backupFileName } from '@/lib/backup';
import { uploadBackup, CloudApiError } from '@/lib/cloud-api';
import { syncNow, initSyncListeners } from '@/lib/sync';
import { onLocalChange } from '@/lib/change-counter';
import { connectSyncRealtime, disconnectSyncRealtime } from '@/lib/sync-realtime';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { toast } from 'sonner';

const HOUR_MS = 60 * 60 * 1000;

/** Debounce perubahan data → sync (rentang transaksi multi-tabel digabung). */
const SYNC_DEBOUNCE_MS = 4000;

/** Pull berkala saat tab terlihat (PWA tanpa daemon — kompromi realtime). */
const SYNC_PULL_MS = 60 * 1000;

/** Interval auto-backup tetap: 12 jam (keputusan 2026-08-12 — tanpa setting manual). */
const AUTO_BACKUP_INTERVAL_MS = 12 * HOUR_MS;

/**
 * Menjalankan auto-backup ke cloud saat app dibuka, bila:
 *  - user sudah login Google & punya langganan aktif,
 *  - interval auto-backup tetap (12 jam),
 *  - sudah lewat dari interval sejak backup cloud terakhir.
 *
 * PWA/WebView tidak punya background daemon, jadi pengecekan terjadi sekali
 * tiap app dibuka (saat kondisi siap), dijaga ref agar tidak dobel.
 */
export function useCloudAutoBackup() {
  const { isLoggedIn, profile, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const ranRef = useRef(false);
  const activeStoreId = storeSettings?.cloudStoreId ?? null;
  const activeStoreHasSync = !!profile?.stores?.find((store) => store.id === activeStoreId)?.entitlement.hasSync;

  useEffect(() => {
    if (ranRef.current) return;
    if (!storeSettings) return;
    if (!isLoggedIn || !activeStoreHasSync) return;

    // Retry otomatis saat kembali online / app terlihat lagi (Phase A stabilisasi).
    initSyncListeners();

    // Sync lintas perangkat (M2): jalankan sekali per sesi bila toko terhubung.
    // Fail-silent — jangan ganggu UX; kegagalan tidak menandai data tersinkron.
    if (storeSettings.cloudStoreId) {
      void syncNow().catch((err) => console.warn('[sync] auto gagal:', err));
    }

    const ms = AUTO_BACKUP_INTERVAL_MS;
    const last = storeSettings.lastCloudBackupAt ? new Date(storeSettings.lastCloudBackupAt).getTime() : 0;
    // A newly activated store always receives one initial backup
    // (lastCloudBackupAt kosong → langsung due, tanpa menunggu 12 jam).
    const due = last === 0 || Date.now() - last >= ms;
    if (!due) return;

    // A backup can be restored without binding the device to a cloud store.
    // This keeps backup recovery available while cross-device sync is disabled.
    const storeId = storeSettings.cloudStoreId ?? undefined;

    ranRef.current = true; // tandai sudah jalan untuk sesi ini

    (async () => {
      try {
        // CLOUD-005: backup cloud tidak membawa credential lokal.
        const json = await buildCloudBackupJsonString();
        await uploadBackup(json, backupFileName(), storeId);
        if (storeSettings.id) {
          await db.storeSettings.update(storeSettings.id, { lastCloudBackupAt: new Date() });
        }
        await refreshProfile();
        toast.success('Backup otomatis ke cloud berhasil');
      } catch (err) {
        ranRef.current = false;
        if (err instanceof CloudApiError && err.status === 400) {
          toast.error('Auto-backup gagal: kuota cloud penuh. Hapus backup lama atau upgrade paket.');
        } else {
          console.warn('[auto-backup] gagal:', err);
        }
      }
    })();
  }, [storeSettings, isLoggedIn, activeStoreHasSync, refreshProfile]);

  // Auto-sync realtime: perubahan data lokal → debounce → syncNow().
  // Sinyal hanya pemicu; mutex di syncNow mencegah overlap; perubahan hasil
  // pull sudah bersyncedAt → siklus lanjutan kosong dan berhenti sendiri.
  useEffect(() => {
    if (!storeSettings?.cloudStoreId) return;
    if (!isLoggedIn || !activeStoreHasSync) return;

    let timer: number | undefined;
    const schedule = () => {
      if (!navigator.onLine || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void syncNow().catch((err) => console.warn('[sync] realtime gagal:', err));
      }, SYNC_DEBOUNCE_MS);
    };
    const unsub = onLocalChange(schedule);
    return () => {
      unsub();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [storeSettings?.cloudStoreId, isLoggedIn, activeStoreHasSync]);

  // Auto-sync antar-perangkat: pull berkala (hanya saat tab terlihat) + saat
  // kembali online / tab terlihat + sinyal realtime Supabase (B1).
  useEffect(() => {
    if (!storeSettings?.cloudStoreId) return;
    if (!isLoggedIn || !activeStoreHasSync) return;

    connectSyncRealtime(storeSettings.cloudStoreId);

    const run = () => {
      if (!navigator.onLine) return;
      void syncNow().catch((err) => console.warn('[sync] auto berkala gagal:', err));
    };
    initSyncListeners();

    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, SYNC_PULL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onOnline = () => run();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      disconnectSyncRealtime();
    };
  }, [storeSettings?.cloudStoreId, isLoggedIn, activeStoreHasSync]);
}
