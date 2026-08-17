/**
 * Rate limiting — fixed-window.
 *
 * SEC-002 (2026-08-17): state dipindah ke Cloudflare KV (binding RATE_LIMIT_KV)
 * agar konsisten lintas isolate. Tanpa binding (local dev / test) fallback ke
 * Map in-memory per-isolate.
 *
 * CATATAN (ponytail): KV eventually-consistent — dalam burst paralel ekstrem,
 * counter bisa undercount (read-modify-write tidak atomik). Untuk limit
 * anti-abuse ringan ini acceptable. Upgrade path: Durable Object counter
 * atau KV linearizable bila diperlukan.
 */

interface WindowState {
  windowStart: number;
  count: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 120;

const store = new Map<string, WindowState>();

/** Interface minimal KV agar mudah di-mock di test. */
export interface RateLimitKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Bersihkan state basi agar Map tidak membengkak (hanya saat besar). */
function sweep(now: number, windowMs: number): void {
  if (store.size <= 10_000) return;
  for (const [k, v] of store) {
    if (now - v.windowStart > windowMs) store.delete(k);
  }
}

function inMemory(key: string, max: number, windowMs: number, now: number): RateLimitResult {
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

/**
 * Cek apakah key diizinkan dalam window berjalan.
 * @param key Kunci unik (mis. `u:<userId>` atau `ip:<ip>`)
 * @param max Jumlah request maksimum per window
 * @param windowMs Panjang window dalam milidetik
 * @param kv Binding KV opsional — bila diberikan, counter konsisten lintas-isolate.
 */
export async function rateLimit(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
  kv?: RateLimitKv | null,
): Promise<RateLimitResult> {
  const now = Date.now();

  if (kv) {
    const bucket = Math.floor(now / windowMs);
    const kvKey = `rl:${key}:${bucket}`;
    const cur = Number(await kv.get(kvKey)) || 0;
    if (cur >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    // KV min TTL 60 detik; bucket key sudah memisahkan window, jadi aman.
    await kv.put(kvKey, String(cur + 1), { expirationTtl: Math.max(60, Math.ceil(windowMs / 1000)) });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return inMemory(key, max, windowMs, now);
}

/** Ekstrak key rate limit dari koneksi (user jika login, IP jika anon). */
export function rateLimitKey(userId: string | null, c: { req: { header: (n: string) => string | undefined } }): string {
  if (userId) return `u:${userId}`;
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown';
  return `ip:${ip}`;
}

