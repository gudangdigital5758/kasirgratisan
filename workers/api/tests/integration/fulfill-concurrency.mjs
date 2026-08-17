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
  '20260808150000_per_store_subscription.sql',
  '20260811110000_cloud_billing_atomic.sql',
];

const url = process.env.POSTGRES_TEST_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

const AUTH_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
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
    await pool.query(`insert into public.profiles (id, email) values ($1, 'it@test.local')`, [user]);

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
        pool.query(`select public.fulfill_cloud_payment($1, $2, 'test', $1::text) as r`, [payA, user]),
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
      await pool.query(`select public.fulfill_cloud_payment($1, $2, 'test', $1::text) as r`, [payA, user])
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
      await pool.query(`select public.fulfill_cloud_payment($1, $2, 'test', 'x')`, [payA, user2]);
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
    await pool.query(`select public.fulfill_cloud_payment($1, $2, 'test', $1::text)`, [payD, user]);
    const subCountD = (
      await pool.query(
        `select count(*)::int c from public.subscriptions where store_id = $1 and status = 'active'`,
        [storeA],
      )
    ).rows[0].c;
    check('D1: tetap 1 subscription (extend, bukan duplikat)', subCountD === 1, `c=${subCountD}`);

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
