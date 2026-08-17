#!/usr/bin/env node
/**
 * Integration test — concurrency & idempotency RPC `fulfill_cloud_payment`
 * (TST-002: double-charge / race condition pada jalur uang inti).
 *
 * Membutuhkan Postgres 15 (service postgres di CI, atau docker).
 *   POSTGRES_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
 *     node tests/integration/fulfill-concurrency.mjs
 *
 * Setup: auth stub → migrasi inti (init, per_store_subscription,
 * cloud_billing_atomic) → seed plan → data uji → 5 fulfill CONCURRENT
 * untuk payment yang sama → assert tepat 1 pemenang.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
  '20260723000000_init_profitku.sql',
  '20260724180000_vouchers.sql',
  '20260808150000_per_store_subscription.sql',
  '20260811110000_cloud_billing_atomic.sql',
  '20260817020000_fix_fulfill_cloud_payment_raw.sql',
  '20260817030000_fix_batch_fulfillment_raw.sql',
];

const url = process.env.POSTGRES_TEST_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

const AUTH_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
`;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} ${extra}`);
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  try {
    await pool.query(AUTH_STUB);
    for (const m of MIGRATIONS) {
      const sql = readFileSync(path.join(DIR, '../../../../supabase/migrations', m), 'utf8');
      await pool.query(sql);
    }
    await pool.query(readFileSync(path.join(DIR, '../../../../supabase/seed.sql'), 'utf8'));
    console.log('setup: auth stub + migrations + seed applied');

    const user = (
      await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'it@test.local') returning id`)
    ).rows[0].id;
    // profiles dibuat otomatis oleh trigger on_auth_user_created (init migration).

    // === Test A: 5 fulfill CONCURRENT untuk payment yang sama ===
    console.log('Test A: concurrency (5 parallel fulfill, satu payment)');
    const storeA = (
      await pool.query(`insert into public.stores (user_id, name) values ($1, 'IT Store A') returning id`, [user])
    ).rows[0].id;
    const payA = (
      await pool.query(
        `insert into public.payments (user_id, plan_id, amount, status, store_id) values ($1, 'cloud_monthly', 25000, 'PENDING', $2) returning id`,
        [user, storeA],
      )
    ).rows[0].id;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        pool.query(`select public.fulfill_cloud_payment($1::uuid, $2::uuid, 'test', $3::text) as r`, [payA, user, payA]),
      ),
    );
    const parsed = results.map((r) => r.rows[0].r);
    const wins = parsed.filter((r) => r.alreadyDone === false).length;
    const already = parsed.filter((r) => r.alreadyDone === true).length;
    check('A1: tepat 1 pemenang (alreadyDone=false) dari 5 concurrent', wins === 1, JSON.stringify(parsed));
    check('A2: 4 sisanya alreadyDone=true (tanpa grant ganda)', already === 4);

    const subCount = (
      await pool.query(
        `select count(*)::int c from public.subscriptions where store_id = $1 and status = 'active'`,
        [storeA],
      )
    ).rows[0].c;
    check('A3: hanya 1 subscription aktif (unique partial index)', subCount === 1, `c=${subCount}`);

    const payStatus = (await pool.query(`select status from public.payments where id = $1`, [payA])).rows[0].status;
    check('A4: payment COMPLETED', payStatus === 'COMPLETED');

    // === Test B: replay sequential → alreadyDone, tanpa sub baru ===
    console.log('Test B: replay webhook (fulfill ulang payment sama)');
    const rB = (
      await pool.query(`select public.fulfill_cloud_payment($1::uuid, $2::uuid, 'test', $3::text) as r`, [payA, user, payA])
    ).rows[0].r;
    check('B1: replay → alreadyDone=true', rB.alreadyDone === true);
    const subCountB = (
      await pool.query(
        `select count(*)::int c from public.subscriptions where store_id = $1 and status = 'active'`,
        [storeA],
      )
    ).rows[0].c;
    check('B2: tetap 1 subscription', subCountB === 1);

    // === Test C: owner mismatch ditolak ===
    console.log('Test C: owner mismatch');
    const user2 = (
      await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'it2@test.local') returning id`)
    ).rows[0].id;
    let ownerErr = '';
    try {
      await pool.query(`select public.fulfill_cloud_payment($1::uuid, $2::uuid, 'test', 'x')`, [payA, user2]);
    } catch (e) {
      ownerErr = String(e.message);
    }
    check('C1: payment_owner_mismatch', ownerErr.includes('payment_owner_mismatch'), ownerErr);

    // === Test D: payment kedua untuk toko sama → extend, bukan duplikat ===
    console.log('Test D: perpanjangan (payment kedua, toko sama)');
    const payD = (
      await pool.query(
        `insert into public.payments (user_id, plan_id, amount, status, store_id) values ($1, 'cloud_monthly', 25000, 'PENDING', $2) returning id`,
        [user, storeA],
      )
    ).rows[0].id;
    await pool.query(`select public.fulfill_cloud_payment($1::uuid, $2::uuid, 'test', $3::text)`, [payD, user, payD]);
    const subCountD = (
      await pool.query(
        `select count(*)::int c from public.subscriptions where store_id = $1 and status = 'active'`,
        [storeA],
      )
    ).rows[0].c;
    check('D1: tetap 1 subscription (extend, bukan duplikat)', subCountD === 1, `c=${subCountD}`);

    // === Test E: batch fulfillment normal + idempotent replay (FUL-007) ===
    console.log('Test E: batch fulfillment (2 toko) + replay');
    const userE = (
      await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'it-batch@test.local') returning id`)
    ).rows[0].id;
    const storeE1 = (
      await pool.query(`insert into public.stores (user_id, name) values ($1, 'IT Batch E1') returning id`, [userE])
    ).rows[0].id;
    const storeE2 = (
      await pool.query(`insert into public.stores (user_id, name) values ($1, 'IT Batch E2') returning id`, [userE])
    ).rows[0].id;
    const payE = (
      await pool.query(
        `insert into public.payments (user_id, plan_id, amount, status, store_id, raw) values ($1, 'cloud_monthly', 50000, 'PENDING', null, $2::jsonb) returning id`,
        [userE, JSON.stringify({ items: [
          { storeId: storeE1, action: 'subscribe', durationMonths: 1 },
          { storeId: storeE2, action: 'subscribe', durationMonths: 1 },
        ] })],
      )
    ).rows[0].id;

    const rE = (
      await pool.query(`select public.fulfill_cloud_payment_batch($1::uuid, $2::uuid, 'test', $3::text) as r`, [payE, userE, payE])
    ).rows[0].r;
    check('E1: batch fulfilledCount=2', rE.fulfilledCount === 2, JSON.stringify(rE));
    check('E2: batch alreadyDone=false (pertama)', rE.alreadyDone === false);

    const subsE = (
      await pool.query(`select count(*)::int c from public.subscriptions where user_id = $1 and status = 'active'`, [userE])
    ).rows[0].c;
    check('E3: 2 subscription aktif (1 per toko)', subsE === 2, `c=${subsE}`);

    const payEState = (
      await pool.query(`select status, raw->>'batchFulfilled' as bf from public.payments where id = $1`, [payE])
    ).rows[0];
    check('E4: payment COMPLETED + batchFulfilled=true', payEState.status === 'COMPLETED' && payEState.bf === 'true');

    const rE2 = (
      await pool.query(`select public.fulfill_cloud_payment_batch($1::uuid, $2::uuid, 'test', $3::text) as r`, [payE, userE, payE])
    ).rows[0].r;
    check('E5: replay → alreadyDone=true', rE2.alreadyDone === true);
    const subsE2 = (
      await pool.query(`select count(*)::int c from public.subscriptions where user_id = $1 and status = 'active'`, [userE])
    ).rows[0].c;
    check('E6: tetap 2 subscription setelah replay', subsE2 === 2);

    // === Test F: batch CONCURRENT (5 paralel, satu payment BARU) ===
    console.log('Test F: batch concurrency (5 parallel fulfill)');
    const payF = (
      await pool.query(
        `insert into public.payments (user_id, plan_id, amount, status, store_id, raw) values ($1, 'cloud_monthly', 50000, 'PENDING', null, $2::jsonb) returning id`,
        [userE, JSON.stringify({ items: [
          { storeId: storeE1, action: 'subscribe', durationMonths: 1 },
          { storeId: storeE2, action: 'subscribe', durationMonths: 1 },
        ] })],
      )
    ).rows[0].id;
    const resultsF = await Promise.all(
      Array.from({ length: 5 }, () =>
        pool.query(`select public.fulfill_cloud_payment_batch($1::uuid, $2::uuid, 'test', $3::text) as r`, [payF, userE, payF]),
      ),
    );
    const parsedF = resultsF.map((r) => r.rows[0].r);
    const winsF = parsedF.filter((r) => r.alreadyDone === false).length;
    const alreadyF = parsedF.filter((r) => r.alreadyDone === true).length;
    check('F1: tepat 1 pemenang batch dari 5 concurrent', winsF === 1, JSON.stringify(parsedF));
    check('F2: 4 sisanya alreadyDone=true', alreadyF === 4);
    const subsF = (
      await pool.query(`select count(*)::int c from public.subscriptions where user_id = $1 and status = 'active'`, [userE])
    ).rows[0].c;
    check('F3: tetap 2 subscription setelah 5 concurrent', subsF === 2, `c=${subsF}`);

    // === Test G: batch owner mismatch ditolak ===
    console.log('Test G: batch owner mismatch');
    const userG = (
      await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'it-batch-g@test.local') returning id`)
    ).rows[0].id;
    let ownerErrG = '';
    try {
      await pool.query(`select public.fulfill_cloud_payment_batch($1::uuid, $2::uuid, 'test', 'x')`, [payE, userG]);
    } catch (e) {
      ownerErrG = String(e.message);
    }
    check('G1: payment_owner_mismatch', ownerErrG.includes('payment_owner_mismatch'), ownerErrG);

    // === Test H: item toko bukan milik user dilewati (validasi ownership) ===
    console.log('Test H: batch dengan 1 item tidak valid');
    const userH = (
      await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'it-batch-h@test.local') returning id`)
    ).rows[0].id;
    const storeH = (
      await pool.query(`insert into public.stores (user_id, name) values ($1, 'IT Batch H1') returning id`, [userH])
    ).rows[0].id;
    const alienStore = (
      await pool.query(`insert into public.stores (user_id, name) values ($1, 'IT Alien') returning id`, [userG])
    ).rows[0].id;
    const payH = (
      await pool.query(
        `insert into public.payments (user_id, plan_id, amount, status, store_id, raw) values ($1, 'cloud_monthly', 25000, 'PENDING', null, $2::jsonb) returning id`,
        [userH, JSON.stringify({ items: [
          { storeId: storeH, action: 'subscribe', durationMonths: 1 },
          { storeId: alienStore, action: 'subscribe', durationMonths: 1 },
        ] })],
      )
    ).rows[0].id;
    const rH = (
      await pool.query(`select public.fulfill_cloud_payment_batch($1::uuid, $2::uuid, 'test', $3::text) as r`, [payH, userH, payH])
    ).rows[0].r;
    check('H1: fulfilledCount=1 (item alien dilewati)', rH.fulfilledCount === 1, JSON.stringify(rH));
    const subsH = (
      await pool.query(`select count(*)::int c from public.subscriptions where user_id = $1 and status = 'active'`, [userH])
    ).rows[0].c;
    check('H2: 1 subscription untuk userH', subsH === 1, `c=${subsH}`);

    console.log(failures === 0 ? '\nALL INTEGRATION TESTS PASSED' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
