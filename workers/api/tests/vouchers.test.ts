import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  computeEffect,
  computeNewPeriod,
  extensionBaseDate,
  recordRedemption,
  validateVoucherForUser,
  type VoucherRow,
} from '../src/lib/vouchers';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: 'https://db.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc-role',
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

function voucherRow(over: Partial<VoucherRow> = {}): VoucherRow {
  return {
    id: 'v1',
    code: 'GRATIS25',
    type: 'percent',
    value: 100,
    plan_id: 'cloud_monthly',
    max_redemptions: null,
    max_per_user: 1,
    first_time_only: false,
    starts_at: null,
    ends_at: null,
    is_active: true,
    note: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('computeEffect (harga voucher server-side)', () => {
  it('percent 100% → gratis 1 bulan (amountAfter 0)', () => {
    const e = computeEffect({ type: 'percent', value: 100 }, 25000);
    expect(e.amountAfter).toBe(0);
    expect(e.discountIdr).toBe(25000);
    expect(e.grantDays).toBe(30);
    expect(e.isLifetime).toBe(false);
  });

  it('percent 50% → setengah harga', () => {
    const e = computeEffect({ type: 'percent', value: 50 }, 25000);
    expect(e.amountAfter).toBe(12500);
    expect(e.discountIdr).toBe(12500);
  });

  it('percent di-clamp 1..100', () => {
    expect(computeEffect({ type: 'percent', value: 0 }, 25000).value).toBe(1);
    expect(computeEffect({ type: 'percent', value: 999 }, 25000).value).toBe(100);
  });

  it('free_days → grantDays sesuai value, amountAfter 0', () => {
    const e = computeEffect({ type: 'free_days', value: 7 }, 25000);
    expect(e.grantDays).toBe(7);
    expect(e.amountAfter).toBe(0);
    expect(e.discountIdr).toBe(25000);
  });

  it('lifetime → isLifetime true', () => {
    const e = computeEffect({ type: 'lifetime', value: 0 }, 25000);
    expect(e.isLifetime).toBe(true);
    expect(e.amountAfter).toBe(0);
  });
});

describe('extensionBaseDate / computeNewPeriod (periode langganan)', () => {
  const now = new Date('2026-08-17T00:00:00.000Z');

  it('tanpa sub aktif → mulai dari now', () => {
    expect(extensionBaseDate(null, now).toISOString()).toBe(now.toISOString());
  });

  it('sub aktif → perpanjang dari period_end (bukan now)', () => {
    const base = extensionBaseDate(
      { current_period_end: '2026-09-01T00:00:00.000Z', is_lifetime: false, status: 'active' },
      now,
    );
    expect(base.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('sub lifetime → base = now (tidak menumpuk)', () => {
    const base = extensionBaseDate(
      { current_period_end: '2099-12-31T23:59:59.000Z', is_lifetime: true, status: 'active' },
      now,
    );
    expect(base.toISOString()).toBe(now.toISOString());
  });

  it('computeNewPeriod: paid default +30 hari dari period_end', () => {
    const r = computeNewPeriod({
      existing: { id: 's1', plan_id: 'cloud_monthly', status: 'active', current_period_start: '2026-08-01T00:00:00.000Z', current_period_end: '2026-09-01T00:00:00.000Z', is_lifetime: false },
      effect: { type: 'percent', grantDays: null, isLifetime: false },
      now,
    });
    expect(r.endIso).toBe('2026-10-01T00:00:00.000Z');
    expect(r.isLifetime).toBe(false);
  });

  it('computeNewPeriod: durationMonths 6 → +180 hari', () => {
    const r = computeNewPeriod({
      existing: null,
      effect: { type: 'percent', grantDays: null, isLifetime: false },
      durationMonths: 6,
      now,
    });
    expect(r.endIso).toBe('2027-02-13T00:00:00.000Z');
  });

  it('computeNewPeriod: lifetime → 2099', () => {
    const r = computeNewPeriod({
      existing: null,
      effect: { type: 'lifetime', grantDays: null, isLifetime: true },
      now,
    });
    expect(r.endIso).toBe('2099-12-31T23:59:59.000Z');
    expect(r.isLifetime).toBe(true);
  });

  it('computeNewPeriod: free_days menumpuk di atas period_end aktif', () => {
    const r = computeNewPeriod({
      existing: { id: 's1', plan_id: 'cloud_monthly', status: 'active', current_period_start: '2026-08-01T00:00:00.000Z', current_period_end: '2026-09-01T00:00:00.000Z', is_lifetime: false },
      effect: { type: 'free_days', grantDays: 7, isLifetime: false },
      now,
    });
    expect(r.endIso).toBe('2026-09-08T00:00:00.000Z');
  });
});

describe('validateVoucherForUser (validasi server-side)', () => {
  const env = makeEnv();
  const opts = { code: 'GRATIS25', userId: 'u1', planId: 'cloud_monthly', listPrice: 25000 };

  it('voucher tidak ditemukan / nonaktif → invalid', async () => {
    stubSupabase(() => json([]));
    expect((await validateVoucherForUser(env, opts)).valid).toBe(false);
    stubSupabase((url) => (url.includes('/rest/v1/vouchers') ? json([voucherRow({ is_active: false })]) : json([])));
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(false);
  });

  it('belum berlaku / kedaluwarsa → invalid', async () => {
    stubSupabase((url) =>
      url.includes('/rest/v1/vouchers')
        ? json([voucherRow({ starts_at: '2099-01-01T00:00:00.000Z' })])
        : json([]),
    );
    const r1 = await validateVoucherForUser(env, opts);
    expect(r1.valid).toBe(false);
    if (!r1.valid) expect(r1.error).toContain('belum berlaku');

    stubSupabase((url) =>
      url.includes('/rest/v1/vouchers')
        ? json([voucherRow({ ends_at: '2020-01-01T00:00:00.000Z' })])
        : json([]),
    );
    const r2 = await validateVoucherForUser(env, opts);
    expect(r2.valid).toBe(false);
    if (!r2.valid) expect(r2.error).toContain('kedaluwarsa');
  });

  it('plan mismatch → invalid', async () => {
    stubSupabase((url) =>
      url.includes('/rest/v1/vouchers') ? json([voucherRow({ plan_id: 'plan-lain' })]) : json([]),
    );
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('tidak berlaku untuk paket');
  });

  it('kuota global habis (max_redemptions) → invalid', async () => {
    stubSupabase((url) => {
      if (url.includes('/rest/v1/vouchers')) return json([voucherRow({ max_redemptions: 5 })]);
      if (url.includes('/rest/v1/voucher_redemptions')) return json([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }]);
      return json([]);
    });
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('Kuota');
  });

  it('max_per_user tercapai → invalid', async () => {
    stubSupabase((url) => {
      if (url.includes('/rest/v1/vouchers')) return json([voucherRow({ max_per_user: 1 })]);
      if (url.includes('/rest/v1/voucher_redemptions')) return json([{ id: 'r1' }]);
      return json([]);
    });
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('sudah memakai');
  });

  it('first_time_only + user pernah punya subscription → ditolak', async () => {
    stubSupabase((url) => {
      if (url.includes('/rest/v1/vouchers')) return json([voucherRow({ first_time_only: true })]);
      if (url.includes('/rest/v1/voucher_redemptions')) return json([]);
      if (url.includes('/rest/v1/subscriptions')) return json([{ id: 's1' }]);
      return json([]);
    });
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('hanya untuk pengguna baru');
  });

  it('valid (percent 100%) → gratis 1 bulan dengan voucherId', async () => {
    stubSupabase((url) => {
      if (url.includes('/rest/v1/vouchers')) return json([voucherRow({})]);
      if (url.includes('/rest/v1/voucher_redemptions')) return json([]);
      if (url.includes('/rest/v1/subscriptions')) return json([]);
      return json([]);
    });
    const r = await validateVoucherForUser(env, opts);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.voucherId).toBe('v1');
      expect(r.amountAfter).toBe(0);
      expect(r.message).toContain('gratis 1 bulan');
    }
  });
});

describe('recordRedemption (idempotent per payment di pemanggil)', () => {
  it('POST voucher_redemptions dengan payload lengkap', async () => {
    const posts: { url: string; init?: RequestInit }[] = [];
    stubSupabase((url, init) => {
      if (init?.method === 'POST' && url.includes('/rest/v1/voucher_redemptions')) {
        posts.push({ url, init });
        return json([{}]);
      }
      return json([]);
    });

    await recordRedemption(makeEnv(), {
      voucherId: 'v1',
      userId: 'u1',
      paymentId: 'p1',
      amountBefore: 25000,
      amountAfter: 0,
      effect: { type: 'percent', value: 100, grantDays: 30, isLifetime: false, code: 'GRATIS25' },
    });

    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0].init?.body)) as Record<string, unknown>;
    expect(body.voucher_id).toBe('v1');
    expect(body.user_id).toBe('u1');
    expect(body.payment_id).toBe('p1');
    expect(body.amount_before).toBe(25000);
    expect(body.effect).toMatchObject({ code: 'GRATIS25' });
  });
});

