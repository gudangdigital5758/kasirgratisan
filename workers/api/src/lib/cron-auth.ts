import type { Env } from '../env';

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.startsWith('v1,') ? value.slice(3) : value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Verify a manual cron request using HMAC-SHA256(timestamp.method.pathname).
 * A dedicated CRON_HMAC_SECRET avoids reusing the generic WEBHOOK_SECRET.
 * The short timestamp window prevents replay after a captured request expires.
 */
export async function verifyCronHmac(env: Env, request: Request): Promise<boolean> {
  const secret = env.CRON_HMAC_SECRET;
  const timestamp = request.headers.get('x-cron-timestamp') || '';
  const signature = request.headers.get('x-cron-signature') || '';
  const signatureBytes = base64ToBytes(signature);
  const timestampSeconds = Number(timestamp);

  if (!secret || !signatureBytes || !Number.isInteger(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const url = new URL(request.url);
  const payload = `${timestamp}.${request.method.toUpperCase()}.${url.pathname}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(payload),
  );
}