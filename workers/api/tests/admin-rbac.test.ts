import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { resolveAdmin } from '../src/lib/admin';

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

describe('resolveAdmin (RBAC admin — TST-001)', () => {
  it('email di ADMIN_EMAILS env → superadmin (fallback)', async () => {
    stubSupabase((url) => (url.includes('/rest/v1/admin_users') ? json([]) : json([])));
    const admin = await resolveAdmin(makeEnv({ ADMIN_EMAILS: 'ops@profitku.my.id,other@x.com' }), 'u1', 'ops@profitku.my.id');
    expect(admin).toMatchObject({ userId: 'u1', email: 'ops@profitku.my.id', role: 'superadmin' });
  });

  it('baris admin_users aktif → role dari tabel menang', async () => {
    stubSupabase((url) =>
      url.includes('/rest/v1/admin_users')
        ? json([{ user_id: 'u1', role: 'finance', is_active: true }])
        : json([]),
    );
    const admin = await resolveAdmin(makeEnv({ ADMIN_EMAILS: 'ops@profitku.my.id' }), 'u1', 'someone@x.com');
    expect(admin?.role).toBe('finance');
  });

  it('tanpa tabel dan tanpa allowlist → null (bukan staff)', async () => {
    stubSupabase((url) => (url.includes('/rest/v1/admin_users') ? json([]) : json([])));
    const admin = await resolveAdmin(makeEnv({}), 'u1', 'random@x.com');
    expect(admin).toBeNull();
  });
});

describe('GET /admin/api/me (requireAdmin route-level)', () => {
  function adminEnv(overrides: Partial<Env> = {}) {
    return makeEnv({ ADMIN_EMAILS: 'ops@profitku.my.id', ...overrides });
  }

  it('staff (allowlist) + JWT valid → 200 role superadmin', async () => {
    stubSupabase((url) => {
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'ops@profitku.my.id', user_metadata: {} });
      if (url.includes('/rest/v1/admin_users')) return json([]);
      return json([]);
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/admin/api/me', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      }),
      adminEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: 'u1', role: 'superadmin' });
  });

  it('bukan staff → 403', async () => {
    stubSupabase((url) => {
      if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'random@x.com', user_metadata: {} });
      if (url.includes('/rest/v1/admin_users')) return json([]);
      return json([]);
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/admin/api/me', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      }),
      adminEnv(),
    );
    expect(res.status).toBe(403);
  });

  it('tanpa token → 401 (fail-closed)', async () => {
    stubSupabase(() => json([]));
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/admin/api/me'),
      adminEnv(),
    );
    expect(res.status).toBe(401);
  });
});
