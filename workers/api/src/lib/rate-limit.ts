/**
 * Rate limiting sederhana — fixed-window, in-memory.
 *
 * CATATAN PRODUCTION: state ini per-isolate Worker. Untuk skala multi-isolate
 * sebaiknya pindah ke Cloudflare KV / Durable Objects. Cukup untuk membatasi
 * penyalahgunaan ringan (upload bomb, spam webhook) di satu instance.
 */

interface WindowState {
  windowStart: number;
  count: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 120;

const store = new Map<string, WindowState>();

/** Bersihkan state basi agar Map tidak membengkak (hanya saat besar). */
function sweep(now: number, windowMs: number): void {
  if (store.size <= 10_000) return;
  for (const [k, v] of store) {
    if (now - v.windowStart > windowMs) store.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Cek apakah key diizinkan dalam window berjalan.
 * @param key Kunci unik (mis. `u:<userId>` atau `ip:<ip>`)
 * @param max Jumlah request maksimum per window
 * @param windowMs Panjang window dalam milidetik
 */
export function rateLimit(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  const state = store.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    store.set(key, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  state.count += 1;
  if (state.count > max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Ekstrak key rate limit dari koneksi (user jika login, IP jika anon). */
export function rateLimitKey(userId: string | null, c: { req: { header: (n: string) => string | undefined } }): string {
  if (userId) return `u:${userId}`;
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown';
  return `ip:${ip}`;
}
