import { useEffect, useRef } from 'react';

/**
 * Refetch otomatis saat tab kembali fokus/terlihat + interval opsional.
 * Dipakai halaman admin supaya data (settings, mitra, payout) selalu segar
 * tanpa reload manual — perubahan dari tab lain / cron terlihat otomatis.
 */
export function useAutoRefresh(refresh: () => void, intervalMs?: number): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRef.current();
    };
    const onFocus = () => refreshRef.current();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    const id = intervalMs ? window.setInterval(() => refreshRef.current(), intervalMs) : null;

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      if (id !== null) window.clearInterval(id);
    };
  }, [intervalMs]);
}

/** Jam terakhir refresh (untuk indikator kesegaran di UI). */
export function refreshStamp(): string {
  return new Date().toLocaleTimeString('id-ID');
}
