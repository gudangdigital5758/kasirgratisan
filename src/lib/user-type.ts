import { db } from './db';
import { BRAND } from './brand';

/**
 * Survei "jenis usaha" — ditampilkan saat user membuka halaman Laporan.
 * User boleh melewati (skip); modal muncul lagi di kunjungan berikutnya.
 * Setelah SKIP_LIMIT kali skip, modal menawarkan opsi "jangan tampilkan lagi".
 * Jawaban dikirim ke webhook (fire-and-forget) dan ditandai selesai secara lokal.
 */

const WEBHOOK_URL = `${BRAND.apiOrigin}/webhook/user-type`;
const TIMEOUT_MS = 8000;

const ANSWERED_KEY = 'profitku_user_type_answered_v1';
const DISMISSED_KEY = 'profitku_user_type_dismissed_v1';
const SKIP_COUNT_KEY = 'profitku_user_type_skips_v1';

/** Jumlah skip sebelum opsi "jangan tampilkan lagi" ditawarkan. */
export const SKIP_LIMIT = 3;

export const BUSINESS_TYPES = [
  'Warung Kelontong',
  'Coffee Shop',
  'Kafe / Resto',
  'Toko Pakaian',
  'Toko Sembako',
  'Apotek / Toko Obat',
  'Toko Bangunan',
  'Toko Elektronik',
  'Salon / Barbershop',
  'Laundry',
  'Pedagang Online',
  'Lainnya',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Apakah modal survei perlu ditampilkan saat membuka Laporan. */
export function shouldShowUserTypeSurvey(): boolean {
  return !localStorage.getItem(ANSWERED_KEY) && !localStorage.getItem(DISMISSED_KEY);
}

export function getSkipCount(): number {
  const raw = localStorage.getItem(SKIP_COUNT_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Tambah hitungan skip; kembalikan hitungan baru. */
export function incrementSkipCount(): number {
  const next = getSkipCount() + 1;
  localStorage.setItem(SKIP_COUNT_KEY, String(next));
  return next;
}

/** Tandai user memilih untuk tidak menampilkan survei lagi. */
export function dismissUserTypeSurvey(): void {
  localStorage.setItem(DISMISSED_KEY, '1');
}

/** Tandai survei sudah dijawab agar tidak muncul lagi. */
export function markUserTypeAnswered(): void {
  localStorage.setItem(ANSWERED_KEY, '1');
}

/**
 * Kirim jawaban ke webhook. Fire-and-forget dengan timeout; jangan blokir UI.
 * @returns true bila request terkirim (HTTP ok), false bila gagal.
 */
export async function submitUserType(businessType: string): Promise<boolean> {
  try {
    const settings = await db.storeSettings.toCollection().first();
    const identifier = settings?.deviceId ?? 'unknown';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, 'business-type': businessType }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
