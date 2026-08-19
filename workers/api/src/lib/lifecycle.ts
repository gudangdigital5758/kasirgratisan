/**
 * Lifecycle langganan Profitku Cloud:
 * - invoice email (Resend) + WA konfirmasi (Fonnte) saat bayar sukses
 * - dunning H-3 / H-1 via cron
 */

import type { Env } from '../env';
import { sendEmail, sendPush, sendWhatsApp } from './notify';
import { sbGet, sbPatch, sbPost } from './supabase';
import { writeEvent } from './admin';
import { isDunningEnabled } from './platform-settings';

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
    channel: 'email' | 'whatsapp' | 'push';
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

  // Push (OneSignal) — External ID = Supabase user id
  if (opts.userId) {
    const res = await sendPush(env, {
      externalUserId: opts.userId,
      title: 'Profitku Cloud aktif',
      body: `${opts.planName} aktif s/d ${formatDateId(opts.periodEnd)}. Backup cloud siap dipakai.`,
      url: `${APP}/settings/cloud`,
      data: { type: 'subscription_activated', paymentId: opts.paymentId },
    });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'push',
      recipient: opts.userId,
      template: 'push_subscription_activated',
      status: res.ok ? 'sent' : `failed:${res.error}`,
      providerRef: res.id,
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

  if (opts.userId) {
    const res = await sendPush(env, {
      externalUserId: opts.userId,
      title: opts.daysLeft === 3 ? 'Langganan berakhir 3 hari lagi' : 'Langganan berakhir besok',
      body: `${opts.planName} aktif s/d ${endLabel}. Perpanjang agar backup cloud tetap aman.`,
      url: `${APP}/settings/cloud`,
      data: { type: 'dunning', daysLeft: String(opts.daysLeft) },
    });
    await logNotification(env, {
      userId: opts.userId,
      channel: 'push',
      recipient: opts.userId,
      template: opts.daysLeft === 3 ? 'push_dunning_h3' : 'push_dunning_h1',
      status: res.ok ? 'sent' : `failed:${res.error}`,
      providerRef: res.id,
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

  // Flag dunning_enabled=false → hitung kandidat tapi jangan kirim apa pun.
  const enabled = await isDunningEnabled(env);
  if (!enabled) {
    console.log('[dunning] dunning_enabled=false — tidak mengirim pengingat');
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

  if (!enabled) {
    return { checked: subs.length, sent: 0 };
  }

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

/**
 * Cron harian: deteksi payment PENDING yang menggantung (> 48 jam) — menutup
 * gap FUL-008/FUL-010 (payment hanya selesai via webhook; tanpa jalur pulih).
 * Default: NON-DESTRUKTIF — hanya menulis alert ke platform_events.
 * AUTO_FAIL_STALE_PENDING=true → tandai FAILED (opsional, keputusan ops).
 */
export async function flagStalePendingPayments(
  env: Env,
): Promise<{ checked: number; alerted: number; failed: number }> {
  const result = { checked: 0, alerted: 0, failed: 0 };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[stale-pending] Supabase belum dikonfigurasi — skip');
    return result;
  }

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  const autoFail = env.AUTO_FAIL_STALE_PENDING === 'true';

  type Row = {
    id: string;
    user_id: string;
    amount: number;
    provider: string | null;
    created_at: string;
    raw?: Record<string, unknown> | null;
  };
  const rows = await sbGet<Row[]>(
    env,
    `payments?status=eq.PENDING&created_at=lt.${cutoff.toISOString()}&select=id,user_id,amount,provider,created_at,raw&limit=200`,
  ).catch(() => [] as Row[]);
  result.checked = rows.length;

  for (const p of rows) {
    const ageHours = Math.round((Date.now() - new Date(p.created_at).getTime()) / 3600000);
    await writeEvent(env, {
      level: 'warn',
      type: 'payment.stale_pending',
      source: 'cron',
      subjectUserId: p.user_id,
      payload: {
        paymentId: p.id,
        amount: p.amount,
        provider: p.provider,
        ageHours,
        autoFailed: autoFail,
      },
    });
    result.alerted += 1;

    if (autoFail) {
      await sbPatch(env, `payments?id=eq.${p.id}`, {
        status: 'FAILED',
        raw: { ...(p.raw || {}), stalePending: { flaggedAt: new Date().toISOString(), autoFailed: true } },
      }).catch(() => undefined);
      result.failed += 1;
    }
  }

  return result;
}

const LEGACY_PIN_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Cron harian: scan anomali billing (FUL-006 + SEC-008 lanjutan). Non-destruktif —
 * hanya menulis alert ke platform_events.
 * 1) Payment COMPLETED tanpa subscription_id (24 jam terakhir) → indikasi fulfill
 *    tidak lengkap.
 * 2) Member cloud_team_members dengan pin_hash legacy SHA-256 (64 hex) — belum
 *    pernah login ulang pasca SEC-001; hash TIDAK bisa dimigrasi (butuh PIN),
 *    hanya bisa di-upgrade saat login — alert agar ops tahu.
 */
export async function flagBillingAnomalies(
  env: Env,
): Promise<{ checkedCompleted: number; legacyPins: number; alerts: number }> {
  const result = { checkedCompleted: 0, legacyPins: 0, alerts: 0 };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[billing-anomalies] Supabase belum dikonfigurasi — skip');
    return result;
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  type CompletedPay = { id: string; user_id: string; amount: number };
  const completed = await sbGet<CompletedPay[]>(
    env,
    `payments?status=eq.COMPLETED&subscription_id=is.null&updated_at=gte.${since.toISOString()}&select=id,user_id,amount&limit=50`,
  ).catch(() => [] as CompletedPay[]);
  result.checkedCompleted = completed.length;
  for (const p of completed) {
    await writeEvent(env, {
      level: 'warn',
      type: 'billing.payment_completed_without_subscription',
      source: 'cron',
      subjectUserId: p.user_id,
      payload: { paymentId: p.id, amount: p.amount },
    });
    result.alerts += 1;
  }

  type MemberRow = { id: string; store_id: string; username: string | null; pin_hash: string | null };
  const members = await sbGet<MemberRow[]>(
    env,
    `cloud_team_members?pin_hash=not.is.null&select=id,store_id,username,pin_hash&limit=200`,
  ).catch(() => [] as MemberRow[]);
  const legacy = members.filter((m) => m.pin_hash && LEGACY_PIN_HASH_RE.test(m.pin_hash));
  result.legacyPins = legacy.length;
  for (const m of legacy) {
    await writeEvent(env, {
      level: 'warn',
      type: 'billing.legacy_pin_hash',
      source: 'cron',
      payload: { memberId: m.id, storeId: m.store_id, username: m.username },
    });
    result.alerts += 1;
  }

  // FUL-006: email ringkasan ke admin bila ada anomali (no-op tanpa RESEND_API_KEY).
  if (result.alerts > 0 && env.ADMIN_EMAILS) {
    const items: string[] = [];
    if (result.checkedCompleted > 0) {
      items.push(`${result.checkedCompleted} payment COMPLETED tanpa subscription_id (24 jam terakhir)`);
    }
    if (result.legacyPins > 0) {
      items.push(`${result.legacyPins} member dengan pin_hash legacy SHA-256 (belum login ulang)`);
    }
    await sendEmail(env, {
      to: env.ADMIN_EMAILS.split(/[,;\s]+/).filter(Boolean),
      subject: `[Profitku] Billing alert: ${result.alerts} anomali`,
      html:
        '<p>Anomali billing terdeteksi (cron billing-health):</p><ul>' +
        items.map((i) => `<li>${i}</li>`).join('') +
        '</ul><p>Detail: platform_events tipe billing.* (source=cron).</p>',
    }).catch(() => undefined);
  }

  return result;
}
