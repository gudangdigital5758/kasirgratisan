/**
 * Formatting bersama: mata uang, locale angka, dan locale tanggal (date-fns).
 * Dulu diduplikasi di Cashier.tsx & Products.tsx — kini satu sumber kebenaran.
 */

import { id, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';

export const CURRENCY_SYMBOL: Record<string, string> = {
  id: 'Rp',
  en: 'Rp', // UI bahasa Inggris tetap pakai Rp (konsisten dengan struk & produk)
  ms: 'Rp',
};

export const NUMBER_LOCALES: Record<string, string> = {
  id: 'id-ID',
  en: 'en-US',
  ms: 'ms-MY',
};

export const DATE_LOCALES: Record<string, Locale> = {
  id,
  en: enUS,
  ms,
};

/** Kode locale 2 huruf yang dipakai app (id | en | ms), fallback 'id'. */
export function appLang(language?: string): string {
  return (language || 'id').split('-')[0];
}

/** Simbol mata uang untuk bahasa aktif. */
export function currencySymbolFor(lang?: string): string {
  return CURRENCY_SYMBOL[appLang(lang)] ?? 'Rp';
}

/** Locale angka untuk bahasa aktif. */
export function numberLocaleFor(lang?: string): string {
  return NUMBER_LOCALES[appLang(lang)] ?? 'id-ID';
}

/** Locale date-fns untuk bahasa aktif. */
export function dateLocaleFor(lang?: string): Locale {
  return DATE_LOCALES[appLang(lang)] ?? id;
}

/** Format uang: `Rp 12.500` (atau `$ 12.50` untuk en). */
export function formatMoney(n: number, lang?: string): string {
  return `${currencySymbolFor(lang)} ${n.toLocaleString(numberLocaleFor(lang))}`;
}
