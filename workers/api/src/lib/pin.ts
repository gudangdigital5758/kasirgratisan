/**
 * PIN cloud team — PBKDF2-SHA256 via WebCrypto (native di Cloudflare Workers).
 *
 * Format hash baru:  pbkdf2$<iterasi>$<salt b64url>$<hash b64url>
 * Format legacy:     64 hex = SHA-256(pin:memberId) — diverifikasi saat login,
 *                    lalu otomatis di-upgrade ke PBKDF2 (verifyPin → needsRehash).
 * Iterasi disimpan di string hash sehingga bisa dinaikkan tanpa migrasi data.
 *
 * SEC-001 remediation (2026-08-17): SHA-256 tanpa KDF → PBKDF2-SHA256,
 * salt acak 16 byte per member, 210.000 iterasi, compare timing-safe.
 */
export const PBKDF2_ITERATIONS = 210_000;

const PBKDF2_PREFIX = 'pbkdf2$';
const SALT_BYTES = 16;
const KEY_BITS = 256;
const LEGACY_SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Compare constant-time (tanpa short-circuit pada byte pertama). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hash PIN baru (PBKDF2-SHA256, salt acak per member, memberId sebagai domain binding). */
export async function hashPin(pin: string, memberId: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await pbkdf2(`${pin}:${memberId}`, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${toB64url(salt)}$${toB64url(key)}`;
}

export type PinVerifyResult = { ok: boolean; needsRehash: boolean };

/**
 * Verifikasi PIN terhadap stored hash.
 * - pbkdf2$... → derive + compare timing-safe.
 * - legacy 64-hex → SHA-256(pin:memberId); ok → needsRehash=true (pemanggil
 *   menyimpan hash PBKDF2 baru setelah login sukses).
 */
export async function verifyPin(
  pin: string,
  memberId: string,
  stored: string | null,
): Promise<PinVerifyResult> {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts = stored.split('$');
    if (parts.length !== 4) return { ok: false, needsRehash: false };
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 10_000) return { ok: false, needsRehash: false };
    try {
      const salt = fromB64url(parts[2]);
      const actual = await pbkdf2(`${pin}:${memberId}`, salt, iterations);
      return { ok: safeEqual(toB64url(actual), parts[3]), needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  if (LEGACY_SHA256_HEX_RE.test(stored)) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pin}:${memberId}`));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const ok = safeEqual(hex, stored);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}
