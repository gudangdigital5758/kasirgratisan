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
    ENVIRONMENT: 'production',
    PAYMENT_PROVIDER: 'sumopod',
    WEBHOOK_SECRET: 'sekret',
    ...overrides,
  } as Env;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function trigger(fetchStub: (url: string) => Response, envOverrides: Partial<Env> = {}): Promise<{ res: Response; resendCalls: number }> {
  let resendCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.resend.com')) {
        resendCalls++;
        return json({ id: 'email-1' });
      }
      return fetchStub(url);
    }),
  );
  const res = await worker.fetch(
    new Request('https://api.profitku.my.id/api/cron/billing-health', {
      method: 'POST',
      headers: { 'x-cron-secret': 'sekret' },
    }),
    makeEnv({
      RESEND_API_KEY: 're-test',
      ADMIN_EMAILS: 'ops@profitku.my.id',
      ...envOverrides,
    }),
  );
  return { res, resendCalls };
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/cron/billing-health (FUL-006 + SEC-008 lanjutan)', () => {
  it('COMPLETED tanpa subscription_id (24 jam) → alert + email admin', async () => {
    const { res, resendCalls } = await trigger((url) => {
      if (url.includes('/rest/v1/payments?status=eq.COMPLETED')) {
        return json([{ id: 'pay-x', user_id: 'u1', amount: 25000 }]);
      }
      if (url.includes('/rest/v1/cloud_team_members')) return json([]);
      if (url.includes('/rest/v1/platform_events')) return json([]);
      return json([]);
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkedCompleted: 1, legacyPins: 0, alerts: 1 });
    expect(resendCalls).toBe(1);
  });

  it('member dengan pin_hash legacy SHA-256 → alert + email admin', async () => {
    const { res, resendCalls } = await trigger((url) => {
      if (url.includes('/rest/v1/payments?status=eq.COMPLETED')) return json([]);
      if (url.includes('/rest/v1/cloud_team_members')) {
        return json([
          { id: 'm1', store_id: 's1', username: 'kasir1', pin_hash: 'ab'.repeat(32) },
          { id: 'm2', store_id: 's1', username: 'kasir2', pin_hash: 'pbkdf2$210000$salt$hash' },
        ]);
      }
      if (url.includes('/rest/v1/platform_events')) return json([]);
      return json([]);
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkedCompleted: 0, legacyPins: 1, alerts: 1 });
    expect(resendCalls).toBe(1);
  });

  it('bersih → tidak ada alert & tidak ada email', async () => {
    const { res, resendCalls } = await trigger((url) => {
      if (url.includes('/rest/v1/payments?status=eq.COMPLETED')) return json([]);
      if (url.includes('/rest/v1/cloud_team_members')) return json([]);
      if (url.includes('/rest/v1/platform_events')) return json([]);
      return json([]);
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkedCompleted: 0, legacyPins: 0, alerts: 0 });
    expect(resendCalls).toBe(0);
  });
});