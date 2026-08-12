/**
 * Penghitung perubahan data (OFFLINE-BACKUP M1 + auto-sync realtime).
 *
 * Dinaikkan setiap mutasi pada tabel data (lewat setupSyncHooks) sehingga
 * deteksi "apakah ada perubahan?" untuk snapshot lokal murah dan akurat
 * (tidak perlu membandingkan seluruh isi DB).
 *
 * In-memory saja — cukup untuk sesi aplikasi yang sedang aktif. Setelah
 * reload, counter mulai dari 0; snapshot pertama per interval tetap dibuat
 * (perilaku yang diinginkan untuk user awam).
 *
 * Selain counter, listener (onLocalChange) dipanggil pada setiap mutasi —
 * dipakai auto-sync antar-perangkat sebagai pemicu "ada data baru" (debounce
 * di hook, bukan di sini).
 */

let counter = 0;

const listeners = new Set<() => void>();

export function bumpChangeCounter(): void {
  counter++;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Listener tidak boleh merusak hook Dexie (creating/updating/deleting).
    }
  }
}

export function getChangeCounter(): number {
  return counter;
}

/** Daftarkan callback yang dipanggil setiap ada mutasi data lokal. Return unsubscribe. */
export function onLocalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

