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
    SUMOPOD_API_KEY: 'sp-key',
    RESEND_API_KEY: 'x',
    FONNTE_TOKEN: 'y',
    ONESIGNAL_APP_ID: 'z',
    ONESIGNAL_REST_API_KEY: 'w',
    ...overrides,
  } as Env;
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /health (SEC-006 info disclosure)', () => {
  it('production default: subset aman tanpa provider/config detail', async () => {
    const res = await worker.fetch(new Request('https://api.profitku.my.id/health'), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('profitku-api');
    expect(body).not.toHaveProperty('supabase');
    expect(body).not.toHaveProperty('r2');
    expect(body).not.toHaveProperty('paymentProvider');
    expect(body).not.toHaveProperty('midtrans');
    expect(body).not.toHaveProperty('sumopod');
  });

  it('production ?full=1: detail penuh tersedia untuk tooling/monitoring', async () => {
    const res = await worker.fetch(new Request('https://api.profitku.my.id/health?full=1'), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.supabase).toBe(true);
    expect(body.paymentProvider).toBe('sumopod');
    expect(body.sumopod).toBe(true);
  });

  it('non-production: tetap detail penuh (dev/debug)', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/health'),
      makeEnv({ ENVIRONMENT: 'development' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.paymentProvider).toBe('sumopod');
  });
});