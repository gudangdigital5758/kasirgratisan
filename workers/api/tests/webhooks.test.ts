import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORDER_ID = '8b0f2e1a-9c3d-4e5f-8a7b-6c5d4e3f2a1b';
const SERVER_KEY = 'Mid-server-test-key-1234567890';
const SUMOPOD_KEY = 'test-secret-key-0123456789';

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

function stubSupabase(routes: (url: string) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => routes(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function midtransSignature(orderId: string, statusCode: string, grossAmount: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-512',
    new TextEncoder().encode(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function svixHeaders(rawBody: string): Promise<Record<string, string>> {
  const id = 'msg_test123';
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SUMOPOD_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
}

const PAY = {
  id: ORDER_ID,
  user_id: 'u1',
  plan_id: 'cloud_monthly',
  status: 'PENDING',
  provider: 'midtrans',
  store_id: 's1',
  subscription_id: null,
  amount: 25000,
  raw: {},
};

function billingMock(rpc: () => unknown, pay: unknown = PAY) {
  return stubSupabase((url) => {
    if (url.includes('/rpc/fulfill_cloud_payment')) return json(rpc());
    if (url.includes('/rest/v1/payments')) return json([pay]);
    if (url.includes('/rest/v1/plans')) return json([{ name: 'Profitku Cloud' }]);
    if (url.includes('/rest/v1/profiles')) return json([{ phone: null }]);
    if (url.includes('/rest/v1/platform_events')) return json([]);
    if (url.includes('/rest/v1/app_settings')) return json([]);
    return json([]);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /webhook/payment (Midtrans — signature + amount + idempotency)', () => {
  const env = makeEnv({ PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: SERVER_KEY });

  it('signature valid + amount cocok → COMPLETED; replay webhook → alreadyDone tanpa grant ganda', async () => {
    let rpcCalls = 0;
    const rpc = () =>
      ++rpcCalls === 1
        ? { alreadyDone: false, subscriptionId: 's1', periodEnd: '2099-12-31T23:59:59.000Z', isLifetime: false }
        : { alreadyDone: true, periodEnd: '2099-12-31T23:59:59.000Z', isLifetime: false };
    billingMock(rpc);

    const body = {
      order_id: ORDER_ID,
      status_code: '200',
      gross_amount: '25000',
      transaction_status: 'capture',
      fraud_status: 'accept',
      signature_key: await midtransSignature(ORDER_ID, '200', '25000'),
    };
    const req = () =>
      worker.fetch(
        new Request('https://api.profitku.my.id/webhook/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env,
      );

    const res1 = await req();
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(rpcCalls).toBe(1);

    const res2 = await req();
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(rpcCalls).toBe(2);
  });

  it('amount mismatch → 400, fulfill TIDAK dipanggil', async () => {
    let rpcCalls = 0;
    billingMock(() => (rpcCalls++, { alreadyDone: false }));
    const body = {
      order_id: ORDER_ID,
      status_code: '200',
      gross_amount: '30000',
      transaction_status: 'settlement',
      signature_key: await midtransSignature(ORDER_ID, '200', '30000'),
    };
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'payment amount mismatch' });
    expect(rpcCalls).toBe(0);
  });

  it('signature invalid → 401', async () => {
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: ORDER_ID,
          status_code: '200',
          gross_amount: '25000',
          transaction_status: 'settlement',
          signature_key: 'deadbeef',
        }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('order tidak dikenal → skipped unknown_order (200, tanpa fulfill)', async () => {
    let rpcCalls = 0;
    billingMock(() => (rpcCalls++, { alreadyDone: false }), null);
    const body = {
      order_id: ORDER_ID,
      status_code: '200',
      gross_amount: '25000',
      transaction_status: 'settlement',
      signature_key: await midtransSignature(ORDER_ID, '200', '25000'),
    };
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'unknown_order' });
    expect(rpcCalls).toBe(0);
  });
});

describe('POST /webhook/sumopod (Svix HMAC)', () => {
  const secret = 'whsec_' + btoa(SUMOPOD_KEY);
  const env = makeEnv({ PAYMENT_PROVIDER: 'sumopod', SUMOPOD_WEBHOOK_SECRET: secret });
  const SUMOPOD_PAY = { ...PAY, provider: 'sumopod' };

  it('event payment.completed signature valid → COMPLETED', async () => {
    let rpcCalls = 0;
    billingMock(
      () => (rpcCalls++, { alreadyDone: false, subscriptionId: 's1', periodEnd: '2099-12-31T23:59:59.000Z', isLifetime: false }),
      SUMOPOD_PAY,
    );

    const rawBody = JSON.stringify({ type: 'payment.completed', data: { order_id: ORDER_ID, payment_id: 'SP-1', amount: 25000 } });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await svixHeaders(rawBody)) },
        body: rawBody,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(rpcCalls).toBe(1);
  });

  it('signature invalid → 401', async () => {
    const rawBody = JSON.stringify({ type: 'payment.completed', data: { order_id: ORDER_ID, amount: 25000 } });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': 'msg_x',
          'svix-timestamp': '1',
          'svix-signature': 'v1,AAAA',
        },
        body: rawBody,
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('event test/ping di-ack tanpa order_id', async () => {
    const rawBody = JSON.stringify({ type: 'endpoint.test', data: {} });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await svixHeaders(rawBody)) },
        body: rawBody,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'test' });
  });

  it('payment.completed tanpa amount → 400 payment amount missing (fail-closed)', async () => {
    let rpcCalls = 0;
    billingMock(() => (rpcCalls++, { alreadyDone: false }), SUMOPOD_PAY);
    const rawBody = JSON.stringify({ type: 'payment.completed', data: { order_id: ORDER_ID, payment_id: 'SP-2' } });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await svixHeaders(rawBody)) },
        body: rawBody,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'payment amount missing' });
    expect(rpcCalls).toBe(0);
  });

  it('event id sama sudah diproses (platform_events) → dedupe tanpa fulfill kedua', async () => {
    let rpcCalls = 0;
    stubSupabase((url) => {
      if (url.includes('/rpc/fulfill_cloud_payment')) {
        rpcCalls++;
        return json({ alreadyDone: false, subscriptionId: 's1', periodEnd: '2099-12-31T23:59:59.000Z', isLifetime: false });
      }
      if (url.includes('/rest/v1/payments')) return json([SUMOPOD_PAY]);
      if (url.includes('/rest/v1/platform_events')) return json([{ id: 'evt-existing' }]);
      if (url.includes('/rest/v1/profiles')) return json([{ phone: null }]);
      if (url.includes('/rest/v1/plans')) return json([{ name: 'Profitku Cloud' }]);
      if (url.includes('/rest/v1/app_settings')) return json([]);
      return json([]);
    });
    const rawBody = JSON.stringify({
      id: 'evt_dup1',
      type: 'payment.completed',
      data: { order_id: ORDER_ID, payment_id: 'SP-3', amount: 25000 },
    });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await svixHeaders(rawBody)) },
        body: rawBody,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'duplicate_event' });
    expect(rpcCalls).toBe(0);
  });

  it('token fallback dipakai secara default (backward-compat) → COMPLETED', async () => {
    let rpcCalls = 0;
    billingMock(
      () => (rpcCalls++, { alreadyDone: false, subscriptionId: 's1', periodEnd: '2099-12-31T23:59:59.000Z', isLifetime: false }),
      SUMOPOD_PAY,
    );
    const envTok = makeEnv({
      PAYMENT_PROVIDER: 'sumopod',
      SUMOPOD_WEBHOOK_TOKEN: 'wh_tok_test',
    });
    const rawBody = JSON.stringify({ type: 'payment.completed', data: { order_id: ORDER_ID, payment_id: 'SP-4', amount: 25000 } });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-token': 'wh_tok_test' },
        body: rawBody,
      }),
      envTok,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'COMPLETED' });
    expect(rpcCalls).toBe(1);
  });

  it('token fallback ditolak saat SUMOPOD_ALLOW_TOKEN_FALLBACK=false (SEC-012) → 401', async () => {
    const envDeny = makeEnv({
      PAYMENT_PROVIDER: 'sumopod',
      SUMOPOD_WEBHOOK_TOKEN: 'wh_tok_test',
      SUMOPOD_ALLOW_TOKEN_FALLBACK: 'false',
    });
    const rawBody = JSON.stringify({ type: 'payment.completed', data: { order_id: ORDER_ID, amount: 25000 } });
    const res = await worker.fetch(
      new Request('https://api.profitku.my.id/webhook/sumopod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-token': 'wh_tok_test' },
        body: rawBody,
      }),
      envDeny,
    );
    expect(res.status).toBe(401);
  });
});

