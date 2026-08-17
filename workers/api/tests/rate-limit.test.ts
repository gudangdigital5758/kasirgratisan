import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimit, type RateLimitKv } from '../src/lib/rate-limit';

/** KV in-memory mock — minimal get/put + TTL (SEC-002). */
class MemoryKv implements RateLimitKv {
  private m = new Map<string, { value: string; exp: number }>();

  async get(key: string): Promise<string | null> {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp <= Date.now()) {
      this.m.delete(key);
      return null;
    }
    return e.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.m.set(key, { value, exp: Date.now() + (opts?.expirationTtl ?? 60) * 1000 });
  }
}

describe('rateLimit — Cloudflare KV (SEC-002)', () => {
  it('blokir setelah max request dalam window; retryAfterSeconds > 0', async () => {
    const kv = new MemoryKv();
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit('kv-1', 3, 60_000, kv)).allowed).toBe(true);
    }
    const blocked = await rateLimit('kv-1', 3, 60_000, kv);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('window baru (bucket berbeda) → counter reset', async () => {
    // FUL-002: gunakan fake timers agar deterministik (tidak bergantung sleep nyata).
    vi.useFakeTimers();
    try {
      const kv = new MemoryKv();
      for (let i = 0; i < 3; i++) {
        expect((await rateLimit('kv-2', 3, 10_000, kv)).allowed).toBe(true);
      }
      expect((await rateLimit('kv-2', 3, 10_000, kv)).allowed).toBe(false);
      vi.advanceTimersByTime(10_001);
      expect((await rateLimit('kv-2', 3, 10_000, kv)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('key berbeda tidak saling memengaruhi', async () => {
    const kv = new MemoryKv();
    await rateLimit('kv-a', 1, 60_000, kv);
    expect((await rateLimit('kv-b', 1, 60_000, kv)).allowed).toBe(true);
    expect((await rateLimit('kv-a', 1, 60_000, kv)).allowed).toBe(false);
  });

  it('kv null → fallback in-memory tetap berfungsi (dev/test)', async () => {
    const key = `mem-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 2; i++) {
      expect((await rateLimit(key, 2, 60_000)).allowed).toBe(true);
    }
    expect((await rateLimit(key, 2, 60_000)).allowed).toBe(false);
  });
});
