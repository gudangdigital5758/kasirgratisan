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

function stubSupabase(routes: (url: string) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => routes(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/payments/verify/:id (SumoPod — FUL-010: tanpa endpoint status)', () => {
  const env = makeEnv({ PAYMENT_PROVIDER: 'sumopod', SUMOPOD_API_KEY: 'sp-key' });

  it('verify SumoPod → PENDING tanpa panggilan provider (status hanya via webhook)', async () => {
    const providerCalls: string[] = [];
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c', user_metadata: {} });
      if (url.includes('/rest/v1/payments?id=eq.verify1')) {
        return json([{ id: 'verify1', plan_id: 'cloud_monthly', status: 'PENDING', user_id: 'u1', amount: 25000 }]);
      }
      if (url.includes('api-pay.sumopod.com')) {
        providerCalls.push(url);
        return json({}, 500);
      }
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });
    vi.stubGlobal('fetch', fn);

    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/payments/verify/verify1', {
        method: 'POST',
        headers: { authorization: 'Bearer token-x' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      message: 'Menunggu konfirmasi webhook pembayaran',
      transaction: { id: 'verify1', status: 'PENDING' },
    });
    // FUL-010: tidak boleh ada pemanggilan ke provider sama sekali.
    expect(providerCalls).toHaveLength(0);
  });
});