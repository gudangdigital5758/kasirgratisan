/**
 * Sync realtime (B1): Supabase Realtime sebagai pemicu "pull sekarang".
 *
 * Event postgres_changes pada sync_records hanyalah SINYAL — tidak membawa
 * data dan tidak menulis ke Dexie. Pipeline push/pull LWW (syncNow) tetap
 * satu-satunya sumber kebenaran; jika event hilang (WS drop / offline),
 * pull berkala + on-visible menutupinya (fail-safe by design).
 *
 * Event push device sendiri juga sampai ke channel ini — memicu satu siklus
 * pull kosong yang netral (mutex syncNow + cursor sudah maju).
 */

import { getSupabase } from '@/lib/supabase-client';
import { syncNow } from '@/lib/sync';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** Debounce burst push (satu push = banyak baris = banyak event). */
const PULL_DEBOUNCE_MS = 1500;

let activeChannel: RealtimeChannel | null = null;
let activeStoreId: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function schedulePull(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void syncNow().catch((err) => console.warn('[sync-realtime] pull gagal:', err));
  }, PULL_DEBOUNCE_MS);
}

/**
 * Subscribe ke event sync_records milik store. Satu channel aktif (app punya
 * satu toko aktif); panggil ulang dengan storeId sama = no-op, storeId beda
 * = tutup lama lalu buka baru. No-op bila Supabase belum dikonfigurasi.
 */
export function connectSyncRealtime(storeId: string): void {
  const supabase = getSupabase();
  if (!supabase || !storeId) return;
  if (activeChannel) {
    if (activeStoreId === storeId) return;
    disconnectSyncRealtime();
  }
  activeStoreId = storeId;
  activeChannel = supabase
    .channel(`sync:${storeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_records', filter: `store_id=eq.${storeId}` },
      () => schedulePull(),
    )
    .subscribe();
}

/** Tutup channel realtime aktif (logout / ganti toko / cleanup effect). */
export function disconnectSyncRealtime(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!activeChannel) return;
  const channel = activeChannel;
  activeChannel = null;
  activeStoreId = null;
  void getSupabase()?.removeChannel(channel).catch(() => {});
}
