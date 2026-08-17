import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const STORE_ID = '8b0f2e1a-9c3d-4e5f-8a7b-6c5d4e3f2a1b';

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

function stubSupabase(routes: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => routes(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('SEC-003 — dev routes /api/dev/*', () => {
  it('tanpa ENABLE_DEV_ROUTES → 403 (walaupun provider mock)', async () => {
    stubSupabase(() => json([]));
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/dev/notify-test', { method: 'POST' }),
      makeEnv({ PAYMENT_PROVIDER: 'mock' }),
    );
    expect(res.status).toBe(403);
  });

  it('ENABLE_DEV_ROUTES=true + provider mock → 200', async () => {
    stubSupabase(() => json([]));
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/dev/notify-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      makeEnv({ PAYMENT_PROVIDER: 'mock', ENABLE_DEV_ROUTES: 'true' }),
    );
    expect(res.status).toBe(200);
  });
});

describe('BILL-006 — PAYMENT_PROVIDER=mock diblokir di production', () => {
  const env = makeEnv({ PAYMENT_PROVIDER: 'mock', ENVIRONMENT: 'production' });

  it('checkout → 503 sebelum membuat payment', async () => {
    let paymentPosts = 0;
    stubSupabase((url, init) => {
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c', user_metadata: {} });
      if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID }]);
      if (url.includes('/rest/v1/plans')) return json([{ id: 'cloud_monthly', name: 'Profitku Cloud', price_idr: 25000, is_active: true, category: 'SYNC' }]);
      if (url.includes('/rest/v1/payments')) {
        paymentPosts++;
        return json([]);
      }
      return json([]);
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
        body: JSON.stringify({ planId: 'cloud_monthly', storeId: STORE_ID }),
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(paymentPosts).toBe(0);
  });

  it('checkout-batch → 503', async () => {
    stubSupabase((url) => {
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c', user_metadata: {} });
      if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID }]);
      if (url.includes('/rest/v1/plans')) return json([{ id: 'cloud_monthly', name: 'Profitku Cloud', price_idr: 25000, is_active: true, category: 'SYNC' }]);
      return json([]);
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/payments/checkout-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
        body: JSON.stringify({ items: [{ storeId: STORE_ID, action: 'subscribe', durationMonths: 1 }] }),
      }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('verify → 503 sebelum auto-complete', async () => {
    stubSupabase((url) => {
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c', user_metadata: {} });
      return json([]);
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/payments/verify/8b0f2e1a-9c3d-4e5f-8a7b-6c5d4e3f2a1b', {
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
      }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('cron manual tanpa WEBHOOK_SECRET → 403', async () => {
    stubSupabase(() => json([]));
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/dunning', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
