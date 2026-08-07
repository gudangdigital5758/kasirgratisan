/**
 * Shared: tandai payment COMPLETED + buat/perpanjang subscription + notif.
 * Mendukung voucher (percent / free_days / lifetime) dari payment.raw.
 */
import type { Env } from '../env';
import { sbGet, sbPatch, sbPost } from './supabase';
import { notifySubscriptionActivated } from './lifecycle';
import { writeEvent } from './admin';
import { CLOUD_PLAN_PRICE_IDR } from '../data/seed-plans';
import {
  computeNewPeriod,
  getActiveSubscription,
  recordRedemption,
  type VoucherEffect,
  type VoucherType,
} from './vouchers';
import { recordAffiliateCommission } from './affiliates';

type PayRaw = {
  mobile?: string | null;
  voucherId?: string | null;
  voucherCode?: string | null;
  voucherType?: VoucherType | null;
  voucherValue?: number | null;
  amountBefore?: number | null;
  grantDays?: number | null;
  isLifetime?: boolean | null;
  midtrans?: unknown;
  [key: string]: unknown;
};

type Pay = {
  id: string;
  plan_id: string;
  status: string;
  user_id: string;
  amount: number;
  raw?: PayRaw | null;
};

function effectFromPayment(pay: Pay): Pick<VoucherEffect, 'isLifetime' | 'grantDays' | 'type' | 'value'> | null {
  const raw = pay.raw;
  if (!raw?.voucherId && !raw?.voucherType) {
    // paid default: 30 hari
    return { type: 'percent', value: 0, grantDays: 30, isLifetime: false };
  }
  const type = (raw.voucherType || 'percent') as VoucherType;
  if (type === 'lifetime' || raw.isLifetime) {
    return { type: 'lifetime', value: raw.voucherValue ?? 0, grantDays: null, isLifetime: true };
  }
  if (type === 'free_days') {
    const days = Math.max(1, Number(raw.grantDays ?? raw.voucherValue) || 1);
    return { type: 'free_days', value: days, grantDays: days, isLifetime: false };
  }
  // percent (termasuk 100% → 1 bulan gratis)
  return {
    type: 'percent',
    value: Number(raw.voucherValue) || 0,
    grantDays: Number(raw.grantDays) || 30,
    isLifetime: false,
  };
}

export async function fulfillCompletedPayment(
  env: Env,
  opts: {
    paymentId: string;
    userId: string;
    userEmail?: string | null;
    provider?: string;
    providerRef?: string | null;
    midtransRaw?: Record<string, unknown> | null;
  },
): Promise<{ alreadyDone: boolean; periodEnd?: string; isLifetime?: boolean }> {
  const pays = await sbGet<Pay[]>(
    env,
    `payments?id=eq.${opts.paymentId}&select=id,plan_id,status,user_id,amount,raw`,
  );
  const pay = pays[0];
  if (!pay) throw new Error('payment_not_found');
  const userId = opts.userId || pay.user_id;

  if (pay.status === 'COMPLETED') {
    return { alreadyDone: true };
  }

  const now = new Date();
  const startIso = now.toISOString();
  const effect = effectFromPayment(pay);
  const existing = await getActiveSubscription(env, userId);
  const period = computeNewPeriod({
    existing,
    effect: effect
      ? { isLifetime: effect.isLifetime, grantDays: effect.grantDays }
      : { isLifetime: false, grantDays: 30 },
    defaultDays: 30,
    now,
  });

  const provider = opts.provider || (pay.amount === 0 ? 'voucher' : 'midtrans');

  await sbPatch(env, `payments?id=eq.${opts.paymentId}`, {
    status: 'COMPLETED',
    provider,
    provider_ref: opts.providerRef || opts.paymentId,
    raw: {
      ...(typeof pay.raw === 'object' && pay.raw ? pay.raw : {}),
      midtrans: opts.midtransRaw || (pay.raw as PayRaw)?.midtrans || null,
      fulfilledAt: startIso,
      periodEnd: period.endIso,
      isLifetime: period.isLifetime,
    },
    updated_at: startIso,
  });

  if (existing) {
    await sbPatch(env, `subscriptions?id=eq.${existing.id}`, {
      status: 'active',
      plan_id: pay.plan_id,
      current_period_start: existing.current_period_start || startIso,
      current_period_end: period.endIso,
      is_lifetime: period.isLifetime,
      provider,
      provider_ref: opts.providerRef || opts.paymentId,
      updated_at: startIso,
    });
  } else {
    await sbPost(env, 'subscriptions', {
      user_id: userId,
      plan_id: pay.plan_id,
      status: 'active',
      current_period_start: startIso,
      current_period_end: period.endIso,
      is_lifetime: period.isLifetime,
      provider,
      provider_ref: opts.providerRef || opts.paymentId,
    });
  }

  // Komisi affiliate (berlaku untuk pembelian pertama & perpanjangan).
  // Idempotent per payment_id; best-effort — tidak menggagalkan fulfillment.
  if (pay.raw?.affiliateCode) {
    await recordAffiliateCommission(env, {
      paymentId: opts.paymentId,
      userId,
      affiliateCode: String(pay.raw.affiliateCode),
      amountPaid: pay.amount,
      capturedAt:
        typeof pay.raw?.affiliateCapturedAt === 'string' ? pay.raw.affiliateCapturedAt : null,
    });
  }

  // Catat redemption (idempotent-ish: skip jika payment sudah punya redemption)
  const voucherId = pay.raw?.voucherId;
  if (voucherId) {
    try {
      const existingRed = await sbGet<{ id: string }[]>(
        env,
        `voucher_redemptions?payment_id=eq.${opts.paymentId}&select=id&limit=1`,
      );
      if (!existingRed[0]) {
        await recordRedemption(env, {
          voucherId: String(voucherId),
          userId,
          paymentId: opts.paymentId,
          amountBefore: Number(pay.raw?.amountBefore ?? pay.amount) || 0,
          amountAfter: pay.amount,
          effect: {
            type: pay.raw?.voucherType,
            value: pay.raw?.voucherValue,
            grantDays: effect?.grantDays,
            isLifetime: period.isLifetime,
            periodEnd: period.endIso,
            code: pay.raw?.voucherCode,
          },
        });
      }
    } catch (err) {
      console.warn('[fulfill] redemption', err);
    }
  }

  let planName = 'Profitku Cloud';
  try {
    type PlanRow = { name: string };
    const plans = await sbGet<PlanRow[]>(env, `plans?id=eq.${pay.plan_id}&select=name`);
    if (plans[0]?.name) planName = plans[0].name;
  } catch {
    /* seed */
  }

  let phone: string | null = pay.raw?.mobile ?? null;
  try {
    type Prof = { phone: string | null };
    const profs = await sbGet<Prof[]>(env, `profiles?id=eq.${userId}&select=phone`);
    if (!phone && profs[0]?.phone) phone = profs[0].phone;
  } catch {
    /* ignore */
  }

  await writeEvent(env, {
    type: 'payment.verified',
    message: period.isLifetime
      ? `Lifetime cloud via ${provider} for plan ${pay.plan_id}`
      : `Payment completed for plan ${pay.plan_id}`,
    subjectUserId: userId,
    payload: {
      paymentId: opts.paymentId,
      planId: pay.plan_id,
      amount: pay.amount,
      provider,
      voucherCode: pay.raw?.voucherCode ?? null,
      isLifetime: period.isLifetime,
      periodEnd: period.endIso,
    },
  });

  await notifySubscriptionActivated(env, {
    userId,
    email: opts.userEmail ?? null,
    phone,
    planName,
    amount: pay.amount ?? CLOUD_PLAN_PRICE_IDR,
    periodStart: startIso,
    periodEnd: period.endIso,
    paymentId: opts.paymentId,
  });

  return { alreadyDone: false, periodEnd: period.endIso, isLifetime: period.isLifetime };
}
