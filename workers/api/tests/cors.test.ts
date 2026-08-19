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
    SUPABASE_SERVICE_ROLE_KEY: 'x',
    SUPABASE_ANON_KEY: 'a',
    ...overrides,
  } as Env;
}

afterEach(() => vi.unstubAllGlobals());

async function acaoFor(origin: string): Promise<string | null> {
  const res = await worker.fetch(
    new Request('https://api.profitku.my.id/health', {
      method: 'GET',
      headers: { origin, Authorization: 'Bearer x' },
    }),
    makeEnv({}),
  );
  return res.headers.get('access-control-allow-origin');
}

// SEC-007: allowlist Pages preview harus scoped ke project admin yang benar (`profitku-admin`),
// bukan wildcard `*-profitku-cloud-dashboard.pages.dev` (project tidak terpakai → misconfig laten).
describe('CORS Pages preview allowlist (SEC-007)', () => {
  it('profitku-admin.pages.dev diizinkan (dibeckan)', async () => {
    expect(await acaoFor('https://profitku-admin.pages.dev')).toBe('https://profitku-admin.pages.dev');
  });

  it('preview per-PR <hash>.profitku-admin.pages.dev diizinkan', async () => {
    expect(await acaoFor('https://abcd1234.profitku-admin.pages.dev')).toBe('https://abcd1234.profitku-admin.pages.dev');
  });

  it('project lain yang tidak terpakai (profitku-cloud-dashboard) TIDAK diizinkan', async () => {
    // ACAO jatuh ke APP_ORIGIN (bukan origin attacker) → browser memblokir.
    expect(await acaoFor('https://evil.profitku-cloud-dashboard.pages.dev')).toBe('https://profitku.my.id');
  });

  it('origin non-allowlist (attacker) -> ACAO default (bukan origin attacker)', async () => {
    expect(await acaoFor('https://attacker.example')).toBe('https://profitku.my.id');
    expect(await acaoFor('https://profitku-cloud-dashboard.pages.dev')).toBe('https://profitku.my.id');
  });

  it('origin resmi custom domain dashboard tetap diizinkan', async () => {
    expect(await acaoFor('https://dashboard.profitku.my.id')).toBe('https://dashboard.profitku.my.id');
  });
});