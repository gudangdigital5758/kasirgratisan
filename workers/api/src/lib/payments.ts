/**
 * Shared: tandai payment COMPLETED + buat subscription 30 hari + notif.
 */
import type { Env } from '../env';
import { sbGet, sbPatch, sbPost } from './supabase';
import { notifySubscriptionActivated } from './lifecycle';
import { writeEvent } from './admin';
import { CLOUD_PLAN_PRICE_IDR } from '../data/seed-plans';

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
): Promise<{ alreadyDone: boolean }> {
  type Pay = {
    id: string;
    plan_id: string;
    status: string;
    user_id: string;
    amount: number;
    raw?: { mobile?: string | null } | null;
  };
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

  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  await sbPatch(env, `payments?id=eq.${opts.paymentId}`, {
    status: 'COMPLETED',
    provider: opts.provider || 'midtrans',
    provider_ref: opts.providerRef || opts.paymentId,
    raw: {
      ...(typeof pay.raw === 'object' && pay.raw ? pay.raw : {}),
      midtrans: opts.midtransRaw || null,
    },
    updated_at: startIso,
  });

  await sbPost(env, 'subscriptions', {
    user_id: userId,
    plan_id: pay.plan_id,
    status: 'active',
    current_period_start: startIso,
    current_period_end: endIso,
    provider: opts.provider || 'midtrans',
    provider_ref: opts.providerRef || opts.paymentId,
  });

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
    message: `Payment completed for plan ${pay.plan_id}`,
    subjectUserId: userId,
    payload: {
      paymentId: opts.paymentId,
      planId: pay.plan_id,
      amount: pay.amount,
      provider: opts.provider || 'midtrans',
    },
  });

  await notifySubscriptionActivated(env, {
    userId,
    email: opts.userEmail ?? null,
    phone,
    planName,
    amount: pay.amount ?? CLOUD_PLAN_PRICE_IDR,
    periodStart: startIso,
    periodEnd: endIso,
    paymentId: opts.paymentId,
  });

  return { alreadyDone: false };
}
