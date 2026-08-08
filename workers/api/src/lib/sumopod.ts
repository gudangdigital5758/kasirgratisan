/**
 * SumoPod Payment Gateway — create payment link + verifikasi webhook.
 * API: https://api-pay.sumopod.com (Quick Start dashboard Managed Payment)
 *  - POST /api/v1/payments  (X-Api-Key) → payment_link_url
 *  - Webhook events: payment.completed | payment.failed | payment.expired | payment.test
 *  - Verifikasi: Svix-style HMAC (svix-id.svix-timestamp.body) ATAU X-Webhook-Token.
 */
import type { Env } from '../env';

const API_BASE = 'https://api-pay.sumopod.com';

export function sumopodConfigured(env: Env): boolean {
  return Boolean(env.SUMOPOD_API_KEY);
}

export type SumopodPaymentResult = {
  paymentId: string;
  orderId: string;
  amount: number;
  fee: number;
  netAmount: number;
  paymentLink: string;
  status: string;
  expiresAt?: string;
};

/**
 * Buat payment link di SumoPod. `orderId` = payment UUID internal Profitku
 * (agar webhook `data.order_id` bisa dipetakan langsung ke baris payments).
 * `expires_in_hours` maksimal 24 jam (peraturan SumoPod).
 */
export async function createSumopodPayment(
  env: Env,
  opts: {
    orderId: string;
    amount: number;
    finishUrl: string;
    cancelUrl?: string;
  },
): Promise<SumopodPaymentResult> {
  const apiKey = env.SUMOPOD_API_KEY;
  if (!apiKey) throw new Error('SUMOPOD_API_KEY belum di-set');
  const amount = Math.max(1, Math.round(opts.amount));

  const res = await fetch(`${API_BASE}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      order_id: opts.orderId,
      amount,
      currency: 'IDR',
      expires_in_hours: 24,
      success_return_url: opts.finishUrl,
      cancel_return_url: opts.cancelUrl || opts.finishUrl,
      payment_method_type_code: 'QRIS',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.payment_id || !data.payment_link_url) {
    const msg =
      String(data.error || data.message || '') ||
      `SumoPod create payment HTTP ${res.status}`;
    throw new Error(msg);
  }
  return {
    paymentId: String(data.payment_id),
    orderId: String(data.order_id || opts.orderId),
    amount: Number(data.amount ?? amount),
    fee: Number(data.fee ?? 0),
    netAmount: Number(data.net_amount ?? 0),
    paymentLink: String(data.payment_link_url),
    status: String(data.status || 'pending'),
    expiresAt: data.expires_at ? String(data.expires_at) : undefined,
  };
}

/** Verifikasi signature webhook gaya Svix: HMAC-SHA256 dari `id.timestamp.rawBody`. */
export async function verifySumopodSignature(
  env: Env,
  opts: {
    svixId: string;
    svixTimestamp: string;
    svixSignature: string;
    rawBody: string;
  },
): Promise<boolean> {
  const secret = env.SUMOPOD_WEBHOOK_SECRET || '';
  if (!secret || !opts.svixId || !opts.svixTimestamp || !opts.svixSignature) {
    return false;
  }
  let secretBytes: Uint8Array;
  try {
    // Secret berbentuk whsec_<base64> (Svix). Dekode ke bytes mentah.
    const bin = atob(secret.replace(/^whsec_/, ''));
    secretBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) secretBytes[i] = bin.charCodeAt(i);
  } catch {
    // Bukan base64 — pakai bytes UTF-8 dari string (tanpa prefix).
    secretBytes = new TextEncoder().encode(secret.replace(/^whsec_/, ''));
  }

  const signedContent = `${opts.svixId}.${opts.svixTimestamp}.${opts.rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // svix-signature bisa berisi beberapa nilai dipisah spasi ("v1,<sig> ...")
  const signatures = opts.svixSignature.split(' ').map((s) => s.split(',')[1]);
  return signatures.some((s) => s === expected);
}

/** Verifikasi alternatif sederhana: header X-Webhook-Token. */
export function verifySumopodToken(env: Env, token?: string | null): boolean {
  const expected = env.SUMOPOD_WEBHOOK_TOKEN || '';
  return Boolean(expected && token && token === expected);
}

export type SumopodStatusResult = {
  orderId: string;
  paymentId?: string;
  status: string;
  raw: Record<string, unknown>;
};

const PAID_SUMOPOD_STATUSES = new Set(['completed', 'paid', 'success', 'settled', 'captured']);
const FAILED_SUMOPOD_STATUSES = new Set(['failed', 'expired', 'cancelled', 'canceled', 'denied']);

/**
 * Cek status payment SumoPod (dipakai polling verifyPayment).
 * Status dianggap "paid" bila stringnya berisi salah satu dari PAID_SUMOPOD_STATUSES.
 * Throws bila API tidak bisa dihubungi — pemanggil harus toleran (anggap PENDING).
 */
export async function getSumopodPaymentStatus(
  env: Env,
  orderId: string,
): Promise<SumopodStatusResult> {
  const apiKey = env.SUMOPOD_API_KEY;
  if (!apiKey) throw new Error('SUMOPOD_API_KEY belum di-set');
  const res = await fetch(`${API_BASE}/api/v1/payments/${encodeURIComponent(orderId)}`, {
    headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(data.error || data.message || '') || `SumoPod status HTTP ${res.status}`,
    );
  }
  return {
    orderId: String(data.order_id || orderId),
    paymentId: data.payment_id ? String(data.payment_id) : undefined,
    status: String(data.status || 'pending'),
    raw: data,
  };
}

export function isSumopodPaidStatus(status: string): boolean {
  const s = status.toLowerCase();
  return PAID_SUMOPOD_STATUSES.has(s) || [...PAID_SUMOPOD_STATUSES].some((k) => s.includes(k));
}

export function isSumopodFailedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return FAILED_SUMOPOD_STATUSES.has(s) || [...FAILED_SUMOPOD_STATUSES].some((k) => s.includes(k));
}

export function isSumopodPaidEvent(eventType?: string): boolean {
  return eventType === 'payment.completed';
}

export function isSumopodFailureEvent(eventType?: string): boolean {
  return eventType === 'payment.failed' || eventType === 'payment.expired';
}
