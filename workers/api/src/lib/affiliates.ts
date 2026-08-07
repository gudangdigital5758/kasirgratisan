/**
 * Affiliate Profitku — link referral + komisi otomatis.
 *
 * Server-only (service role). Komisi dihitung/dicatat SAAT payment COMPLETED
 * (termasuk perpanjangan). Klien hanya mengirim kode referral; persen komisi
 * selalu dibaca dari platform_settings (diatur admin).
 */
import type { Env } from '../env';
import { sbGet, sbPost } from './supabase';

export type AffiliateSettings = {
  enabled: boolean;
  commission_percent: number;
  attribution_days: number;
  min_amount_idr: number;
};

export const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
  enabled: true,
  commission_percent: 10,
  attribution_days: 90,
  min_amount_idr: 0,
};

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  payout_note: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

/** Format kode: 4–24 karakter [A-Z0-9_-], tidak diawali underscore/dash. */
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{3,23}$/;

export function normalizeAffiliateCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidAffiliateCode(code: string): boolean {
  const c = normalizeAffiliateCode(code);
  return c.length >= 4 && CODE_RE.test(c);
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.floor(n)));
}

/** Baca settings affiliate dari platform_settings (fallback default). */
export async function getAffiliateSettings(env: Env): Promise<AffiliateSettings> {
  try {
    const rows = await sbGet<{ key: string; value: Record<string, unknown> }[]>(
      env,
      'platform_settings?key=eq.affiliate&select=key,value&limit=1',
    );
    const v = rows[0]?.value;
    if (v && typeof v === 'object') {
      return {
        enabled: v.enabled !== false,
        commission_percent: clampPercent(Number(v.commission_percent) || 0),
        attribution_days: Math.max(1, Math.min(3650, Number(v.attribution_days) || 90)),
        min_amount_idr: Math.max(0, Math.floor(Number(v.min_amount_idr) || 0)),
      };
    }
  } catch (err) {
    console.warn('[affiliate settings]', err);
  }
  return { ...DEFAULT_AFFILIATE_SETTINGS };
}

/** Muat affiliator aktif berdasarkan kode (case-insensitive). */
export async function loadAffiliateByCode(
  env: Env,
  code: string,
): Promise<AffiliateRow | null> {
  const normalized = normalizeAffiliateCode(code);
  if (!isValidAffiliateCode(normalized)) return null;
  const rows = await sbGet<AffiliateRow[]>(
    env,
    `affiliates?code=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=id,code,name,user_id,payout_note,bank_name,bank_account_no,bank_account_name,is_active,created_at,updated_at&limit=1`,
  );
  return rows[0] ?? null;
}

/** Hitung komisi (floor ke rupiah penuh). */
export function computeCommission(
  amountPaid: number,
  settings: AffiliateSettings,
): { ratePercent: number; commissionIdr: number } {
  const rate = clampPercent(settings.commission_percent);
  const commissionIdr = Math.floor(Math.max(0, Math.floor(amountPaid)) * (rate / 100));
  return { ratePercent: rate, commissionIdr };
}

/**
 * Catat komisi untuk satu payment selesai. Idempotent (unique payment_id).
 * Best-effort — kegagalan di sini TIDAK menggagalkan fulfillment langganan.
 * Berfungsi juga untuk perpanjangan karena dipanggil dari fulfillCompletedPayment.
 *
 * Atribusi: bila `capturedAt` diberikan dan lebih tua dari `attribution_days`,
 * kode dianggap kedaluwarsa dan komisi TIDAK dicatat.
 */
export async function recordAffiliateCommission(
  env: Env,
  opts: {
    paymentId: string;
    userId: string;
    affiliateCode: string;
    amountPaid: number;
    capturedAt?: string | null;
  },
): Promise<boolean> {
  try {
    const settings = await getAffiliateSettings(env);
    if (!settings.enabled) return false;
    if (opts.amountPaid < settings.min_amount_idr) return false;

    // Jendela atribusi: klik link → berlangganan dalam N hari.
    if (opts.capturedAt) {
      const captured = new Date(opts.capturedAt).getTime();
      if (!Number.isFinite(captured) || Date.now() - captured > settings.attribution_days * 86400000) {
        return false;
      }
    }

    const affiliate = await loadAffiliateByCode(env, opts.affiliateCode);
    if (!affiliate) return false;

    const existing = await sbGet<{ id: string }[]>(
      env,
      `affiliate_commissions?payment_id=eq.${opts.paymentId}&select=id&limit=1`,
    );
    if (existing[0]) return true;

    const { ratePercent, commissionIdr } = computeCommission(opts.amountPaid, settings);
    if (commissionIdr <= 0) return false;

    await sbPost(env, 'affiliate_commissions', {
      affiliate_id: affiliate.id,
      payment_id: opts.paymentId,
      user_id: opts.userId,
      amount_paid: opts.amountPaid,
      rate_percent: ratePercent,
      commission_idr: commissionIdr,
      status: 'earned',
    });
    return true;
  } catch (err) {
    console.warn('[affiliate commission]', err);
    return false;
  }
}
