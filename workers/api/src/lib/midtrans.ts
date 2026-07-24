/**
 * Midtrans Snap — create transaction + status + webhook signature.
 * Docs: https://docs.midtrans.com/docs/snap-snap-integration-guide
 */
import type { Env } from '../env';

export type MidtransSnapResult = {
  token: string;
  redirectUrl: string;
};

function isProduction(env: Env): boolean {
  const v = (env.MIDTRANS_IS_PRODUCTION || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'production';
}

function snapBase(env: Env): string {
  return isProduction(env)
    ? 'https://app.midtrans.com'
    : 'https://app.sandbox.midtrans.com';
}

function apiBase(env: Env): string {
  return isProduction(env)
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com';
}

function authHeader(env: Env): string {
  const key = env.MIDTRANS_SERVER_KEY || '';
  // Basic base64(ServerKey + ":")
  const encoded = btoa(`${key}:`);
  return `Basic ${encoded}`;
}

export function midtransConfigured(env: Env): boolean {
  return Boolean(env.MIDTRANS_SERVER_KEY);
}

/** Buat transaksi Snap; order_id = payment UUID internal. */
export async function createSnapTransaction(
  env: Env,
  opts: {
    orderId: string;
    amount: number;
    planName: string;
    customerEmail?: string | null;
    customerName?: string | null;
    finishUrl: string;
  },
): Promise<MidtransSnapResult> {
  if (!env.MIDTRANS_SERVER_KEY) {
    throw new Error('MIDTRANS_SERVER_KEY belum di-set');
  }
  const gross = Math.max(1, Math.round(opts.amount));
  const body = {
    transaction_details: {
      order_id: opts.orderId,
      gross_amount: gross,
    },
    item_details: [
      {
        id: 'cloud_monthly',
        price: gross,
        quantity: 1,
        name: (opts.planName || 'Profitku Cloud').slice(0, 50),
      },
    ],
    customer_details: {
      email: opts.customerEmail || undefined,
      first_name: (opts.customerName || 'Profitku').slice(0, 40),
    },
    callbacks: {
      finish: opts.finishUrl,
    },
  };

  const res = await fetch(`${snapBase(env)}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(env),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    redirect_url?: string;
    error_messages?: string[];
    status_message?: string;
  };
  if (!res.ok || !data.token || !data.redirect_url) {
    const msg =
      data.error_messages?.join(', ') ||
      data.status_message ||
      `Midtrans Snap gagal HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { token: data.token, redirectUrl: data.redirect_url };
}

export type MidtransStatus = {
  orderId: string;
  transactionStatus: string;
  fraudStatus?: string;
  grossAmount?: string;
  statusCode?: string;
  raw: Record<string, unknown>;
};

/** GET transaction status by order_id. */
export async function getTransactionStatus(
  env: Env,
  orderId: string,
): Promise<MidtransStatus> {
  if (!env.MIDTRANS_SERVER_KEY) {
    throw new Error('MIDTRANS_SERVER_KEY belum di-set');
  }
  const res = await fetch(`${apiBase(env)}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: {
      Authorization: authHeader(env),
      Accept: 'application/json',
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      (data.status_message as string) || `Midtrans status HTTP ${res.status}`,
    );
  }
  return {
    orderId: String(data.order_id || orderId),
    transactionStatus: String(data.transaction_status || ''),
    fraudStatus: data.fraud_status ? String(data.fraud_status) : undefined,
    grossAmount: data.gross_amount ? String(data.gross_amount) : undefined,
    statusCode: data.status_code ? String(data.status_code) : undefined,
    raw: data,
  };
}

/** Signature webhook: SHA512(order_id + status_code + gross_amount + ServerKey) */
export async function verifyNotificationSignature(
  env: Env,
  opts: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    signatureKey: string;
  },
): Promise<boolean> {
  const key = env.MIDTRANS_SERVER_KEY || '';
  if (!key || !opts.signatureKey) return false;
  const payload = `${opts.orderId}${opts.statusCode}${opts.grossAmount}${key}`;
  const digest = await crypto.subtle.digest(
    'SHA-512',
    new TextEncoder().encode(payload),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === opts.signatureKey.toLowerCase();
}

/** Status Midtrans yang dianggap bayar sukses. */
export function isPaidStatus(status: string, fraud?: string): boolean {
  const s = status.toLowerCase();
  if (s === 'capture') {
    return !fraud || fraud.toLowerCase() === 'accept';
  }
  return s === 'settlement';
}

export function isPendingStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'pending' || s === 'authorize';
}

export function isFailureStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'deny' || s === 'cancel' || s === 'expire' || s === 'failure';
}
