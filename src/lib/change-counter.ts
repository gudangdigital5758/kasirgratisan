/**
 * Penghitung perubahan data (OFFLINE-BACKUP M1).
 *
 * Dinaikkan setiap mutasi pada tabel data (lewat setupSyncHooks) sehingga
 * deteksi "apakah ada perubahan?" untuk snapshot lokal murah dan akurat
 * (tidak perlu membandingkan seluruh isi DB).
 *
 * In-memory saja — cukup untuk sesi aplikasi yang sedang aktif. Setelah
 * reload, counter mulai dari 0; snapshot pertama per interval tetap dibuat
 * (perilaku yang diinginkan untuk user awam).
 */

let counter = 0;

export function bumpChangeCounter(): void {
  counter++;
}

export function getChangeCounter(): number {
  return counter;
}
