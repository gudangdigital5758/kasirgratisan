import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const HMAC_SECRET = 'cron-hmac-test-secret';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    APP_ORIGIN: 'https://profitku.my.id',
    ADMIN_ORIGIN: 'https://dashboard.profitku.my.id',
    AFFILIATE_ORIGIN: 'https://affiliate.profitku.my.id',
    CLOUD_ORIGIN: 'https://cloud.profitku.my.id',
    SUPABASE_URL: 'https://db.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc-role',
    SUPABASE_ANON_KEY: 'anon',
    ENVIRONMENT: 'production',
    PAYMENT_PROVIDER: 'sumopod',
    CRON_HMAC_SECRET: HMAC_SECRET,
    ...overrides,
  } as Env;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hmacHeaders(
  path: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = `${timestamp}.POST.${path}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return {
    'x-cron-timestamp': String(timestamp),
    'x-cron-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('manual cron HMAC (SEC-011)', () => {
  it('valid timestamped HMAC runs cron without legacy header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/rest/v1/payments?status=eq.PENDING')) return json([]);
        if (url.includes('/rest/v1/app_settings')) return json([]);
        return json([]);
      }),
    );
    const path = '/api/cron/stale-pending';
    const res = await worker.fetch(
      new Request(`https://api.profitku.my.id${path}`, {
        method: 'POST',
        headers: await hmacHeaders(path),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checked: 0, alerted: 0, failed: 0 });
  });

  it('legacy static header is rejected once CRON_HMAC_SECRET is configured', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/stale-pending', {
        method: 'POST',
        headers: { 'x-cron-secret': 'legacy-secret' },
      }),
      makeEnv({ WEBHOOK_SECRET: 'legacy-secret' }),
    );
    expect(res.status).toBe(401);
  });

  it('expired HMAC is rejected (replay window <= 5 minutes)', async () => {
    const path = '/api/cron/stale-pending';
    const res = await worker.fetch(
      new Request(`https://api.profitku.my.id${path}`, {
        method: 'POST',
        headers: await hmacHeaders(path, Math.floor(Date.now() / 1000) - 301),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('signature for another path is rejected', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/cron/stale-pending', {
        method: 'POST',
        headers: await hmacHeaders('/api/cron/dunning'),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});