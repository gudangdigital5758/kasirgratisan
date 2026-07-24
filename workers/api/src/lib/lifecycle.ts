/**
 * Lifecycle langganan Profitku Cloud:
 * - invoice email (Resend) + WA konfirmasi (Fonnte) saat bayar sukses
 * - dunning H-3 / H-1 via cron
 */

import type { Env } from '../env';
import { sendEmail, sendWhatsApp } from './notify';
import { sbGet, sbPost } from './supabase';

const APP = 'https://profitku.my.id';

function formatIdr(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function formatDateId(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export async function logNotification(
  env: Env,
  opts: {
    userId?: string | null;
    channel: 'email' | 'whatsapp';
    recipient: string;
    template: string;
    status: string;
    providerRef?: string;
    payload?: unknown;
  },
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await sbPost(env, 'notification_log', {
      user_id: opts.userId ?? null,
      channel: opts.channel,
      recipient: opts.recipient,
      template: opts.template,
      status: opts.status,
      provider_ref: opts.providerRef ?? null,
      payload: opts.payload ?? null,
    });
  } catch (err) {
    console.warn('[lifecycle] logNotification', err);
  }
}

/** Invoice + konfirmasi setelah pembayaran sukses. */
export async function notifySubscriptionActivated(
  env: Env,
  opts: {
    userId: string;
    email?: string | null;
    phone?: string | null;
    planName: string;
    amount: number;
    periodStart: string;
    periodEnd: string;
    paymentId: string;
  },
): Promise<void> {
  const period = `${formatDateId(opts.periodStart)} – ${formatDateId(opts.periodEnd)}`;

  if (opts.email) {
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#0169ff">Profitku Cloud aktif</h2>
        <p>Terima kasih! Pembayaran langganan Anda berhasil.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666">Paket</td><td style="padding:6px 0;text-align:right"><strong>${opts.planName}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666">Total</td><td style="padding:6px 0;text-align:right"><strong>${formatIdr(opts.amount)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666">Periode</td><td style="padding:6px 0;text-align:right">${period}</td></tr>
          <tr><td style="padding:6px 0;color:#666">No. pembayaran</td><td style="padding:6px 0;text-align:right;font-size:12px">${opts.paymentId}</td></tr>
        </table>
        <p style="margin-top:20px">
          <a href="${APP}/settings/cloud" style="background:#0169ff;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">
            Buka Profitku Cloud
          </a>
        </p>
        <p style="color:#888;font-size:12px;margin-top:24px">— Tim Profitku · profitku.my.id</p>
      </div>
    `;
    const res = await sendEmail(env, {
      to: opts.email,
      subject: `Invoice Profitku Cloud — ${formatIdr(opts.amount)}`,
      html,
    });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'email',
      recipient: opts.email,
      template: 'invoice_subscription_activated',
      status: res.ok ? 'sent' : `failed:${res.error}`,
      providerRef: res.id,
      payload: { paymentId: opts.paymentId, amount: opts.amount },
    });
  }

  if (opts.phone) {
    const msg =
      `*Profitku Cloud aktif*\n\n` +
      `Paket: ${opts.planName}\n` +
      `Total: ${formatIdr(opts.amount)}\n` +
      `Berlaku s/d: ${formatDateId(opts.periodEnd)}\n\n` +
      `Kelola backup: ${APP}/settings/cloud\n` +
      `— Tim Profitku`;
    const res = await sendWhatsApp(env, { target: opts.phone, message: msg });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'whatsapp',
      recipient: opts.phone,
      template: 'wa_subscription_activated',
      status: res.ok ? 'sent' : `failed:${res.error}`,
      payload: { paymentId: opts.paymentId },
    });
  }
}

export async function notifyDunning(
  env: Env,
  opts: {
    userId: string;
    email?: string | null;
    phone?: string | null;
    planName: string;
    periodEnd: string;
    daysLeft: 3 | 1;
  },
): Promise<void> {
  const templateEmail = opts.daysLeft === 3 ? 'dunning_h3_email' : 'dunning_h1_email';
  const templateWa = opts.daysLeft === 3 ? 'dunning_h3_wa' : 'dunning_h1_wa';
  const endLabel = formatDateId(opts.periodEnd);
  const urgency =
    opts.daysLeft === 3
      ? 'Langganan Profitku Cloud Anda akan berakhir dalam *3 hari*.'
      : 'Langganan Profitku Cloud Anda berakhir *besok*.';

  if (opts.email) {
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0169ff">Pengingat perpanjang</h2>
        <p>${urgency.replace(/\*/g, '')}</p>
        <p>Paket: <strong>${opts.planName}</strong><br/>Aktif s/d: <strong>${endLabel}</strong></p>
        <p>Perpanjang sekarang agar backup cloud tetap aman.</p>
        <p><a href="${APP}/settings/cloud" style="background:#0169ff;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Perpanjang Rp 25.000</a></p>
        <p style="color:#888;font-size:12px">— Tim Profitku</p>
      </div>
    `;
    const res = await sendEmail(env, {
      to: opts.email,
      subject:
        opts.daysLeft === 3
          ? 'Pengingat: Profitku Cloud berakhir 3 hari lagi'
          : 'Penting: Profitku Cloud berakhir besok',
      html,
    });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'email',
      recipient: opts.email,
      template: templateEmail,
      status: res.ok ? 'sent' : `failed:${res.error}`,
    });
  }

  if (opts.phone) {
    const msg =
      `*Pengingat Profitku*\n\n${urgency}\n` +
      `Paket: ${opts.planName}\n` +
      `Aktif s/d: ${endLabel}\n\n` +
      `Perpanjang: ${APP}/settings/cloud\n` +
      `— Tim Profitku`;
    const res = await sendWhatsApp(env, { target: opts.phone, message: msg });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'whatsapp',
      recipient: opts.phone,
      template: templateWa,
      status: res.ok ? 'sent' : `failed:${res.error}`,
    });
  }
}

/** Apakah template dunning sudah dikirim untuk user di window ini (hindari spam). */
export async function alreadyNotified(
  env: Env,
  userId: string,
  template: string,
  sinceIso: string,
): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const rows = await sbGet<{ id: string }[]>(
      env,
      `notification_log?user_id=eq.${userId}&template=eq.${template}&created_at=gte.${sinceIso}&status=like.sent*&select=id&limit=1`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cron harian: kirim dunning H-3 dan H-1.
 */
export async function runDunningCron(env: Env): Promise<{ checked: number; sent: number }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[dunning] Supabase belum dikonfigurasi — skip');
    return { checked: 0, sent: 0 };
  }

  type Sub = {
    id: string;
    user_id: string;
    plan_id: string;
    current_period_end: string;
    plans: { name: string } | null;
  };

  const now = new Date();
  const in4d = new Date(now);
  in4d.setDate(in4d.getDate() + 4);

  const subs = await sbGet<Sub[]>(
    env,
    `subscriptions?status=in.(active,trialing)&current_period_end=gte.${now.toISOString()}&current_period_end=lte.${in4d.toISOString()}&select=id,user_id,plan_id,current_period_end,plans(name)`,
  );

  let sent = 0;
  for (const s of subs) {
    const end = new Date(s.current_period_end);
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (24 * 3600 * 1000));
    if (daysLeft !== 3 && daysLeft !== 1) continue;

    const templateBase = daysLeft === 3 ? 'dunning_h3' : 'dunning_h1';
    const since = new Date(now);
    since.setDate(since.getDate() - 2);
    if (await alreadyNotified(env, s.user_id, `${templateBase}_email`, since.toISOString())) {
      continue;
    }

    type Prof = { id: string; email: string | null; phone: string | null; name: string | null };
    const profs = await sbGet<Prof[]>(env, `profiles?id=eq.${s.user_id}&select=id,email,phone,name`);
    const p = profs[0];
    await notifyDunning(env, {
      userId: s.user_id,
      email: p?.email,
      phone: p?.phone,
      planName: s.plans?.name || 'Profitku Cloud',
      periodEnd: s.current_period_end,
      daysLeft: daysLeft as 3 | 1,
    });
    sent++;
  }

  return { checked: subs.length, sent };
}
