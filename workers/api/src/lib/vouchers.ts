/**
 * Validasi + hitung efek voucher cloud (percent | free_days | lifetime).
 * Harga final selalu dihitung di server.
 */
import type { Env } from '../env';
import { sbGet, sbPost } from './supabase';
import {
  CLOUD_PLAN_ID,
  CLOUD_PLAN_PRICE_IDR,
  cloudDurationDays,
} from '../data/seed-plans';

export type VoucherType = 'percent' | 'free_days' | 'lifetime';

export type VoucherRow = {
  id: string;
  code: string;
  type: VoucherType;
  value: number;
  plan_id: string | null;
  max_redemptions: number | null;
  max_per_user: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
};

export type VoucherEffect = {
  type: VoucherType;
  value: number;
  /** Hari ditambahkan ke period_end (free_days, atau 30 untuk percent/paid). */
  grantDays: number | null;
  isLifetime: boolean;
  amountBefore: number;
  amountAfter: number;
  discountIdr: number;
};

export type PreviewResult =
  | {
      valid: true;
      code: string;
      voucherId: string;
      type: VoucherType;
      value: number;
      amountBefore: number;
      amountAfter: number;
      discountIdr: number;
      grantDays: number | null;
      isLifetime: boolean;
      message: string;
    }
  | { valid: false; error: string };

const LIFETIME_END = '2099-12-31T23:59:59.000Z';

export function lifetimePeriodEnd(): string {
  return LIFETIME_END;
}

export function normalizeVoucherCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function addDaysIso(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Basis perpanjang: max(now, period_end) jika sub aktif non-lifetime; else now. */
export function extensionBaseDate(
  existing: { current_period_end: string; is_lifetime?: boolean; status?: string } | null,
  now = new Date(),
): Date {
  if (!existing) return now;
  if (existing.is_lifetime) return now;
  const end = new Date(existing.current_period_end);
  if (Number.isNaN(end.getTime())) return now;
  return end.getTime() > now.getTime() ? end : now;
}

export function computeEffect(
  voucher: Pick<VoucherRow, 'type' | 'value'>,
  listPrice: number,
): VoucherEffect {
  const amountBefore = Math.max(0, Math.floor(listPrice));

  if (voucher.type === 'lifetime') {
    return {
      type: 'lifetime',
      value: voucher.value,
      grantDays: null,
      isLifetime: true,
      amountBefore,
      amountAfter: 0,
      discountIdr: amountBefore,
    };
  }

  if (voucher.type === 'free_days') {
    const days = Math.max(1, Math.floor(voucher.value));
    return {
      type: 'free_days',
      value: days,
      grantDays: days,
      isLifetime: false,
      amountBefore,
      amountAfter: 0,
      discountIdr: amountBefore,
    };
  }

  // percent
  const pct = Math.min(100, Math.max(1, Math.floor(voucher.value)));
  const amountAfter = Math.floor((amountBefore * (100 - pct)) / 100);
  return {
    type: 'percent',
    value: pct,
    grantDays: 30,
    isLifetime: false,
    amountBefore,
    amountAfter,
    discountIdr: amountBefore - amountAfter,
  };
}

export async function loadVoucherByCode(env: Env, code: string): Promise<VoucherRow | null> {
  const normalized = normalizeVoucherCode(code);
  if (normalized.length < 2) return null;
  const rows = await sbGet<VoucherRow[]>(
    env,
    `vouchers?code=eq.${encodeURIComponent(normalized)}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

export async function countRedemptions(env: Env, voucherId: string, userId?: string): Promise<number> {
  // PostgREST: gunakan prefer count — fallback list limit
  let path = `voucher_redemptions?voucher_id=eq.${voucherId}&select=id`;
  if (userId) path += `&user_id=eq.${userId}`;
  path += '&limit=1000';
  const rows = await sbGet<{ id: string }[]>(env, path);
  return rows.length;
}

export async function validateVoucherForUser(
  env: Env,
  opts: { code: string; userId: string; planId: string; listPrice: number },
): Promise<PreviewResult> {
  const normalized = normalizeVoucherCode(opts.code);
  if (normalized.length < 2) {
    return { valid: false, error: 'Kode voucher tidak valid' };
  }

  let voucher: VoucherRow | null;
  try {
    voucher = await loadVoucherByCode(env, normalized);
  } catch {
    return { valid: false, error: 'Layanan voucher belum tersedia' };
  }

  if (!voucher || !voucher.is_active) {
    return { valid: false, error: 'Kode voucher tidak ditemukan atau nonaktif' };
  }

  const now = Date.now();
  if (voucher.starts_at && new Date(voucher.starts_at).getTime() > now) {
    return { valid: false, error: 'Kode voucher belum berlaku' };
  }
  if (voucher.ends_at && new Date(voucher.ends_at).getTime() < now) {
    return { valid: false, error: 'Kode voucher sudah kedaluwarsa' };
  }

  if (voucher.plan_id && voucher.plan_id !== opts.planId) {
    return { valid: false, error: 'Kode tidak berlaku untuk paket ini' };
  }

  try {
    if (voucher.max_redemptions != null) {
      const total = await countRedemptions(env, voucher.id);
      if (total >= voucher.max_redemptions) {
        return { valid: false, error: 'Kuota kode voucher sudah habis' };
      }
    }
    const perUser = await countRedemptions(env, voucher.id, opts.userId);
    if (perUser >= (voucher.max_per_user || 1)) {
      return { valid: false, error: 'Anda sudah memakai kode ini' };
    }
  } catch {
    return { valid: false, error: 'Gagal cek kuota voucher' };
  }

  const effect = computeEffect(voucher, opts.listPrice);
  let message: string;
  if (effect.isLifetime) {
    message = 'Cloud aktif seumur hidup (gratis)';
  } else if (effect.type === 'free_days') {
    message = `Gratis +${effect.grantDays} hari langganan`;
  } else if (effect.amountAfter === 0) {
    message = `Diskon ${effect.value}% — gratis 1 bulan`;
  } else {
    message = `Diskon ${effect.value}% (−Rp ${effect.discountIdr.toLocaleString('id-ID')})`;
  }

  return {
    valid: true,
    code: normalized,
    voucherId: voucher.id,
    type: effect.type,
    value: effect.value,
    amountBefore: effect.amountBefore,
    amountAfter: effect.amountAfter,
    discountIdr: effect.discountIdr,
    grantDays: effect.grantDays,
    isLifetime: effect.isLifetime,
    message,
  };
}

export async function recordRedemption(
  env: Env,
  opts: {
    voucherId: string;
    userId: string;
    paymentId: string | null;
    amountBefore: number;
    amountAfter: number;
    effect: Record<string, unknown>;
  },
): Promise<void> {
  await sbPost(env, 'voucher_redemptions', {
    voucher_id: opts.voucherId,
    user_id: opts.userId,
    payment_id: opts.paymentId,
    amount_before: opts.amountBefore,
    amount_after: opts.amountAfter,
    effect: opts.effect,
  });
}

export async function resolveListPrice(env: Env, planId: string): Promise<{ amount: number; planName: string }> {
  let amount = planId === CLOUD_PLAN_ID ? CLOUD_PLAN_PRICE_IDR : 0;
  let planName = planId === CLOUD_PLAN_ID ? 'Profitku Cloud' : planId;
  try {
    type P = { id: string; name: string; price_idr: number };
    const rows = await sbGet<P[]>(env, `plans?id=eq.${planId}&select=id,name,price_idr`);
    if (rows[0]) {
      amount = rows[0].price_idr;
      planName = rows[0].name;
    }
  } catch {
    /* seed */
  }
  return { amount, planName };
}

export type ActiveSub = {
  id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  is_lifetime: boolean;
};

export async function getActiveSubscription(
  env: Env,
  userId: string,
  storeId: string | null = null,
): Promise<ActiveSub | null> {
  const now = new Date().toISOString();
  const storeFilter = storeId ? `&store_id=eq.${storeId}` : '';
  try {
    const rows = await sbGet<ActiveSub[]>(
      env,
      `subscriptions?user_id=eq.${userId}${storeFilter}&status=in.(active,trialing)&or=(is_lifetime.eq.true,current_period_end.gt.${now})&order=current_period_end.desc&limit=1&select=id,plan_id,status,current_period_start,current_period_end,is_lifetime`,
    );
    return rows[0] ?? null;
  } catch {
    // kolom is_lifetime belum ada — fallback
    const rows = await sbGet<ActiveSub[]>(
      env,
      `subscriptions?user_id=eq.${userId}${storeFilter}&status=in.(active,trialing)&current_period_end=gt.${now}&order=current_period_end.desc&limit=1&select=id,plan_id,status,current_period_start,current_period_end`,
    );
    if (rows[0]) return { ...rows[0], is_lifetime: false };
    return null;
  }
}

export function computeNewPeriod(opts: {
  existing: ActiveSub | null;
  effect: Pick<VoucherEffect, 'isLifetime' | 'grantDays' | 'type'> | null;
  /** Default paid/renew: 30 hari */
  defaultDays?: number;
  /** Durasi berbayar per toko: 1/6/12 bulan (6=180, 12=360 hari) */
  durationMonths?: number;
  now?: Date;
}): { startIso: string; endIso: string; isLifetime: boolean } {
  const now = opts.now ?? new Date();
  const startIso = now.toISOString();

  // Klaim lifetime baru, atau user yang sudah lifetime tetap lifetime
  if (opts.effect?.isLifetime || opts.existing?.is_lifetime) {
    return { startIso, endIso: lifetimePeriodEnd(), isLifetime: true };
  }

  const base = extensionBaseDate(opts.existing, now);
  let days: number;
  if (opts.effect?.type === 'free_days' && opts.effect.grantDays != null) {
    days = opts.effect.grantDays;
  } else if (opts.durationMonths) {
    days = cloudDurationDays(opts.durationMonths);
  } else {
    days = opts.effect?.grantDays ?? opts.defaultDays ?? 30;
  }
  return {
    startIso,
    endIso: addDaysIso(base, days),
    isLifetime: false,
  };
}
