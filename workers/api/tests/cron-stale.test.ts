import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    APP_ORIGIN: 'https://profitku.my.id',
    ADMIN_ORIGIN: 'https://dashboard.profitku.my.id',
    AFFILIATE_ORIGIN: 'https://affiliate.profitku.my.id',
    CLOUD_ORIGIN: 'https://cloud.profitku.my.id',
    SUPABASE_URL: 'https://db.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc-role',
    SUPABASE_ANON_KEY: 'anon',
    ...overrides,
  } as Env;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/cron/stale-pending (payment PENDING menggantung)', () => {
  const OLD_PAY = {
    id: 'p-stale-1',
    user_id: 'u1',
    amount: 25000,
    provider: 'sumopod',
    created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
  };

  function staleEnv(overrides: Partial<Env> = {}): Env {
    return makeEnv({
      ENVIRONMENT: 'production',
      WEBHOOK_SECRET: 'sekret',
      ...overrides,
    });
  }

  it('default: alert platform_events, tanpa menandai FAILED (non-destruktif)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method || 'GET'} ${url}`);
        if (url.includes('/rest/v1/payments?status=eq.PENDING')) return json([OLD_PAY]);
        if (url.includes('/rest/v1/platform_events')) return json([]);
        if (url.includes('/rest/v1/payments?id=eq.p-stale-1')) return json([{ id: 'p-stale-1' }]);
        if (url.includes('/rest/v1/app_settings')) return json([]);
        return json([]);
      }),
    );

    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/stale-pending', {
        method: 'POST',
        headers: { 'x-cron-secret': 'sekret' },
      }),
      staleEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checked: 1, alerted: 1, failed: 0 });
    expect(calls.some((c) => c.includes('platform_events'))).toBe(true);
    // Tidak boleh ada PATCH status payments tanpa izin eksplisit.
    expect(calls.some((c) => c.startsWith('PATCH') && c.includes('payments?id=eq.p-stale-1'))).toBe(false);
  });

  it('AUTO_FAIL_STALE_PENDING=true → tandai FAILED', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method || 'GET'} ${url}`);
        if (url.includes('/rest/v1/payments?status=eq.PENDING')) return json([OLD_PAY]);
        if (url.includes('/rest/v1/platform_events')) return json([]);
        if (url.includes('/rest/v1/payments?id=eq.p-stale-1')) return json([{ id: 'p-stale-1' }]);
        if (url.includes('/rest/v1/app_settings')) return json([]);
        return json([]);
      }),
    );

    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/stale-pending', {
        method: 'POST',
        headers: { 'x-cron-secret': 'sekret' },
      }),
      staleEnv({ AUTO_FAIL_STALE_PENDING: 'true' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checked: 1, alerted: 1, failed: 1 });
    expect(calls.some((c) => c.startsWith('PATCH') && c.includes('payments?id=eq.p-stale-1'))).toBe(true);
  });

  it('production tanpa WEBHOOK_SECRET → 403', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/stale-pending', { method: 'POST' }),
      makeEnv({ ENVIRONMENT: 'production', PAYMENT_PROVIDER: 'sumopod' }),
    );
    expect(res.status).toBe(403);
  });
});