import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { runMonthlyPayouts } from '../src/lib/affiliate-payouts';

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

const AFF = {
  id: 'a1',
  user_id: 'u1',
  has_npwp: true,
  min_amount_idr: null,
  bank_name: 'BCA',
  bank_account_no: '123456',
  bank_account_name: 'Budi',
};

const COMMISSIONS = [
  { id: 'c1', affiliate_id: 'a1', commission_idr: 30000 },
  { id: 'c2', affiliate_id: 'a1', commission_idr: 20000 },
];

describe('runMonthlyPayouts (BILL-004 — atomik via RPC)', () => {
  const env = makeEnv();

  it('sukses: panggil fn_affiliate_payout_create dengan semua komisi; TANPA insert langsung ke tabel', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    stubSupabase((url, init) => {
      calls.push({ url, init });
      if (url.includes('/rpc/fn_affiliate_payout_create')) return json({ ok: true, payoutId: 'p1', bound: 2 });
      if (url.includes('/rest/v1/affiliate_payouts')) return json([]);
      if (url.includes('/rest/v1/affiliates')) return json([AFF]);
      if (url.includes('/rest/v1/affiliate_commissions')) return json(COMMISSIONS);
      if (url.includes('/rest/v1/platform_settings')) return json([]);
      if (url.includes('/rest/v1/profiles')) return json([]);
      if (url.includes('/rest/v1/platform_events')) return json([{}]);
      return json([]);
    });

    const r = await runMonthlyPayouts(env, '2026-07');
    expect(r.created).toBe(1);
    expect(r.errors).toHaveLength(0);

    const rpc = calls.find((c) => c.url.includes('/rpc/fn_affiliate_payout_create'));
    expect(rpc).toBeDefined();
    const body = JSON.parse(String(rpc!.init?.body)) as {
      p_affiliate_id: string;
      p_period: string;
      p_gross_idr: number;
      p_tax_rate_percent: number;
      p_tax_idr: number;
      p_net_idr: number;
      p_bank: Record<string, string>;
      p_commission_ids: string[];
    };
    expect(body.p_affiliate_id).toBe('a1');
    expect(body.p_period).toBe('2026-07');
    expect(body.p_gross_idr).toBe(50000);
    expect(body.p_tax_rate_percent).toBe(2);
    expect(body.p_tax_idr).toBe(1000);
    expect(body.p_net_idr).toBe(49000);
    expect(body.p_bank.bank_name).toBe('BCA');
    expect(body.p_commission_ids).toEqual(['c1', 'c2']);

    const directInsert = calls.find(
      (c) => c.url.includes('/rest/v1/affiliate_payouts') && c.init?.method === 'POST',
    );
    expect(directInsert).toBeUndefined();
  });

  it('periode sudah punya payout → skipped tanpa RPC', async () => {
    let rpcCalls = 0;
    stubSupabase((url, init) => {
      if (url.includes('/rpc/fn_affiliate_payout_create')) {
        rpcCalls++;
        return json({ ok: true, payoutId: 'p1' });
      }
      if (url.includes('/rest/v1/affiliate_payouts')) return json([{ id: 'p0' }]);
      return json([]);
    });

    const r = await runMonthlyPayouts(env, '2026-06');
    expect(r.skipped).toBe(true);
    expect(r.created).toBe(0);
    expect(rpcCalls).toBe(0);
  });

  it('RPC balas skipped (period_exists) → tidak dihitung created', async () => {
    stubSupabase((url, init) => {
      if (url.includes('/rpc/fn_affiliate_payout_create')) return json({ skipped: true, reason: 'period_exists' });
      if (url.includes('/rest/v1/affiliate_payouts')) return json([]);
      if (url.includes('/rest/v1/affiliates')) return json([AFF]);
      if (url.includes('/rest/v1/affiliate_commissions')) return json(COMMISSIONS);
      if (url.includes('/rest/v1/platform_settings')) return json([]);
      if (url.includes('/rest/v1/platform_events')) return json([{}]);
      return json([]);
    });

    const r = await runMonthlyPayouts(env, '2026-07');
    expect(r.created).toBe(0);
    expect(r.errors).toContain('a1:skipped');
  });
});
