/**
 * Affiliate Profitku — penangkapan & penyimpanan jalur referral di perangkat.
 *
 * Alur:
 *  1. User membuka link https://profitku.my.id/?ref=KODE
 *  2. captureAffiliateRef() dipanggil sekali saat app start → validasi via API
 *     (best-effort) → simpan kode ke localStorage.
 *  3. Saat checkout/perpanjangan cloud, kode dikirim sebagai affiliateCode.
 *  4. Komisi dihitung & dicatat server saat payment selesai.
 *
 * Jalur referral bersifat persisten (berlaku juga untuk perpanjangan layanan);
 * hanya ditimpa jika user membuka link affiliator lain.
 */
import { lookupAffiliate } from './cloud-api';

const STORAGE_KEY = 'profitku_affiliate_ref';
/** Jendela atribusi default (hari) — dipakai untuk info; jalur tidak dihapus otomatis. */
export const AFFILIATE_ATTRIBUTION_DAYS = 90;

export interface AffiliateRef {
  code: string;
  name?: string;
  capturedAt: string;
}

/** Format kode: 4–24 karakter [A-Z0-9_-], tidak diawali -/_ (sama dgn server). */
export function looksLikeAffiliateCode(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{3,23}$/.test(code.trim());
}

export function getAffiliateRef(): AffiliateRef | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as AffiliateRef;
    if (!ref?.code || !looksLikeAffiliateCode(ref.code)) return null;
    return { ...ref, code: ref.code.toUpperCase() };
  } catch {
    return null;
  }
}

export function setAffiliateRef(ref: AffiliateRef): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...ref, code: ref.code.toUpperCase() }));
  } catch {
    /* storage penuh / private mode — abaikan */
  }
}

function readRefParam(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return (params.get('ref') || '').trim();
}

/**
 * Panggil sekali saat app start (fire-and-forget).
 * Tangkap ?ref=KODE dari URL → validasi server → simpan bila valid.
 * Bila API offline, kode format-valid tetap disimpan (komisi diverifikasi
 * server ulang saat checkout/fulfillment).
 */
export async function captureAffiliateRef(): Promise<AffiliateRef | null> {
  const code = readRefParam();
  if (!looksLikeAffiliateCode(code)) return getAffiliateRef();

  const normalized = code.toUpperCase();
  try {
    const result = await lookupAffiliate(normalized);
    if (result.valid && result.code) {
      const ref: AffiliateRef = {
        code: result.code.toUpperCase(),
        name: result.name,
        capturedAt: new Date().toISOString(),
      };
      setAffiliateRef(ref);
      return ref;
    }
  } catch {
    /* API down — fallback: simpan kode format-valid */
  }
  setAffiliateRef({ code: normalized, capturedAt: new Date().toISOString() });
  return getAffiliateRef();
}

export function clearAffiliateRef(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
