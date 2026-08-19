import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { sha256Hex } from '../src/lib/session';

const MEMBER_ID = '11111111-2222-3333-4444-555555555555';
const STORE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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
    ...overrides,
  } as Env;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function memberRow(pinHash: string) {
  return {
    id: MEMBER_ID,
    store_id: STORE_ID,
    user_id: null,
    role: 'kasir',
    invite_state: 'active',
    username: 'kasir1',
    name: null,
    pin_hash: pinHash,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

async function loginRequest(ip: string, pin: string) {
  return worker.fetch(
    new Request('https://api.profitku.my.id/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ storeCode: 'ABCD1234', username: 'kasir1', pin }),
    }),
    makeEnv(),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('team session SEC-005 (hash token + logout + eager cleanup)', () => {
  it('login menyimpan token_hash (bukan plaintext) + DELETE expired sesi member', async () => {
    const { hashPin } = await import('../src/lib/pin');
    const pbkdf2Hash = await hashPin('4321', MEMBER_ID);
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          method: init?.method || 'GET',
          url,
          body: init?.body ? String(init.body) : undefined,
        });
        if (url.includes('/rest/v1/cloud_team_members')) return json([memberRow(pbkdf2Hash)]);
        if (url.includes('/rest/v1/store_entitlements')) return json([{ store_id: STORE_ID, has_sync: true }]);
        if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID, name: 'Toko Uji', store_code: 'ABCD1234' }]);
        if (url.includes('/rest/v1/cloud_team_sessions')) return json([{}]);
        if (url.includes('/rest/v1/app_settings')) return json([]);
        return json([]);
      }),
    );

    const res = await loginRequest('203.0.113.20', '4321');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token.length).toBeGreaterThan(10);

    const sessionPost = calls.find((c) => c.method === 'POST' && c.url.includes('cloud_team_sessions'));
    expect(sessionPost).toBeDefined();
    const posted = JSON.parse(sessionPost!.body!) as Record<string, unknown>;
    expect(posted.token_hash).toBe(await sha256Hex(body.token));
    expect(posted.token).toBeUndefined();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('cloud_team_sessions?member_id=eq.'))).toBe(true);
  });

  it('logout menghapus sesi via token_hash dan berhasil', async () => {
    const deletes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE' && url.includes('cloud_team_sessions')) deletes.push(url);
        return json([]);
      }),
    );
    const token = 'session-token-abc';
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/team/logout', {
        method: 'POST',
        headers: { authorization: `Bearer team:${token}` },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(deletes[0]).toContain(`token_hash=eq.${await sha256Hex(token)}`);
  });

  it('logout tanpa token → 401', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/api/team/logout', { method: 'POST' }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});