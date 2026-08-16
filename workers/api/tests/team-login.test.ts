import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const MEMBER_ID = '2a3f4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c';
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

async function legacySha256(pin: string, memberId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pin}:${memberId}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function memberRow(pinHash: string) {
  return {
    id: MEMBER_ID,
    store_id: STORE_ID,
    user_id: null,
    role: 'kasir',
    invite_email: null,
    invite_state: 'active',
    username: 'kasir1',
    name: null,
    pin_hash: pinHash,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function stubSupabase(routes: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => routes(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

async function loginRequest(ip: string, pin: string) {
  return worker.fetch(
    new Request('https://api.profitku.my.id/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ username: 'kasir1', pin }),
    }),
    makeEnv(),
  );
}

describe('POST /api/team/login (PIN PBKDF2 — SEC-001)', () => {
  it('PIN legacy sha256 diverifikasi → login ok → hash otomatis di-upgrade ke pbkdf2$', async () => {
    const legacy = await legacySha256('1234', MEMBER_ID);
    const patches: { url: string; init?: RequestInit }[] = [];
    stubSupabase((url, init) => {
      if (init?.method === 'PATCH') {
        patches.push({ url, init });
        return json([memberRow(legacy)]);
      }
      if (url.includes('/rest/v1/cloud_team_members')) return json([memberRow(legacy)]);
      if (url.includes('/rest/v1/store_entitlements')) return json([{ store_id: STORE_ID, has_sync: true }]);
      if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID, name: 'Toko Uji', store_code: 'ABCD1234' }]);
      if (url.includes('/rest/v1/cloud_team_sessions')) return json([{}]);
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });

    const res = await loginRequest('203.0.113.11', '1234');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; memberships: unknown[] };
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);

    const upgrade = patches.find((p) => p.url.includes('cloud_team_members'));
    expect(upgrade).toBeDefined();
    const patched = JSON.parse(String(upgrade!.init?.body)) as { pin_hash: string };
    expect(patched.pin_hash.startsWith('pbkdf2$')).toBe(true);
  });

  it('PIN baru (pbkdf2) diverifikasi tanpa upgrade', async () => {
    const { hashPin } = await import('../src/lib/pin');
    const pbkdf2Hash = await hashPin('4321', MEMBER_ID);
    let sessionPosts = 0;
    stubSupabase((url, init) => {
      if (url.includes('/rest/v1/cloud_team_members')) return json([memberRow(pbkdf2Hash)]);
      if (url.includes('/rest/v1/store_entitlements')) return json([{ store_id: STORE_ID, has_sync: true }]);
      if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID, name: 'Toko Uji', store_code: 'ABCD1234' }]);
      if (url.includes('/rest/v1/cloud_team_sessions')) {
        sessionPosts++;
        return json([{}]);
      }
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });

    const res = await loginRequest('203.0.113.12', '4321');
    expect(res.status).toBe(200);
    expect(sessionPosts).toBe(1);
  });

  it('PIN salah → 401, tanpa sesi', async () => {
    const { hashPin } = await import('../src/lib/pin');
    const pbkdf2Hash = await hashPin('4321', MEMBER_ID);
    let sessionPosts = 0;
    stubSupabase((url, init) => {
      if (url.includes('/rest/v1/cloud_team_members')) return json([memberRow(pbkdf2Hash)]);
      if (url.includes('/rest/v1/cloud_team_sessions')) {
        sessionPosts++;
        return json([{}]);
      }
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });

    const res = await loginRequest('203.0.113.13', '9999');
    expect(res.status).toBe(401);
    expect(sessionPosts).toBe(0);
  });

  it('rate limit login: 10/menit/IP, percobaan ke-11 → 429', async () => {
    const { hashPin } = await import('../src/lib/pin');
    const pbkdf2Hash = await hashPin('1234', MEMBER_ID);
    stubSupabase((url, init) => {
      if (url.includes('/rest/v1/cloud_team_members')) return json([memberRow(pbkdf2Hash)]);
      if (url.includes('/rest/v1/store_entitlements')) return json([{ store_id: STORE_ID, has_sync: true }]);
      if (url.includes('/rest/v1/stores')) return json([{ id: STORE_ID, name: 'Toko Uji', store_code: 'ABCD1234' }]);
      if (url.includes('/rest/v1/cloud_team_sessions')) return json([{}]);
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });

    const ip = '203.0.113.99';
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      lastStatus = (await loginRequest(ip, '1234')).status;
    }
    expect(lastStatus).toBe(429);
  });
});

