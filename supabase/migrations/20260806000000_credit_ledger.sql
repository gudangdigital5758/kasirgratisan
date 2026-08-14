-- P1 — Credit ledger Profitku Cloud (2026-08-06)
-- Namespace migrasi TERPISAH dari repo kasirgratisan. Additive.
-- Model: Opsi C — MSC cost-only; price book ×1.5 di Profitku (worker middleware).
-- 1 credit = Rp 100. Saldo tidak negatif (dipaksa di level DB).

-- ============================================================
-- Tabel
-- ============================================================
create table if not exists public.credit_packages (
  id bigint generated always as identity primary key,
  name text not null,
  price_rp bigint not null check (price_rp > 0),
  credits bigint not null check (credits > 0),
  bonus_credits bigint not null default 0 check (bonus_credits >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id text,
  balance_credits bigint not null default 0 check (balance_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.credit_accounts(id) on delete cascade,
  type text not null check (type in ('topup','usage','refund','adjust')),
  amount_credits bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  ref text,
  note text,
  idempotency_key text unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_jobs (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.credit_accounts(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','refunded')),
  model_id text,
  mode text,
  resolution text,
  snapgen_cost_credits bigint not null default 0,
  charge_credits bigint not null default 0,
  charge_rp bigint not null default 0,
  msc_job_id text,
  result_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_transactions_account_idx on public.credit_transactions (account_id, created_at desc);
create index if not exists ai_jobs_account_idx on public.ai_jobs (account_id, created_at desc);

-- ============================================================
-- Seed paket top-up (Rp)
-- ============================================================
insert into public.credit_packages (name, price_rp, credits, bonus_credits) values
  ('Starter', 25000, 250, 0),
  ('Hemat', 50000, 500, 10),
  ('Borong', 100000, 1000, 50)
on conflict do nothing;

-- ============================================================
-- RPC atomik: topup (idempotent via idempotency_key)
-- ============================================================
create or replace function public.fn_credit_topup(
  p_user_id uuid,
  p_package_id bigint,
  p_idempotency_key text,
  p_ref text default null,
  p_note text default null
) returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id bigint;
  v_pkg public.credit_packages%rowtype;
  v_new_balance bigint;
  v_tx public.credit_transactions;
begin
  select * into v_tx from public.credit_transactions where idempotency_key = p_idempotency_key;
  if found then return v_tx; end if;

  select * into v_pkg from public.credit_packages where id = p_package_id and is_active;
  if not found then raise exception 'PACKAGE_NOT_FOUND'; end if;

  insert into public.credit_accounts (user_id) values (p_user_id)
  on conflict (user_id) do update set updated_at = now();

  select id, balance_credits into v_account_id, v_new_balance
  from public.credit_accounts where user_id = p_user_id;

  v_new_balance := v_new_balance + v_pkg.credits + v_pkg.bonus_credits;
  update public.credit_accounts set balance_credits = v_new_balance, updated_at = now()
  where id = v_account_id;

  insert into public.credit_transactions
    (account_id, type, amount_credits, balance_after, ref, note, idempotency_key, created_by)
  values
    (v_account_id, 'topup', v_pkg.credits + v_pkg.bonus_credits, v_new_balance, p_ref, coalesce(p_note, v_pkg.name), p_idempotency_key, p_user_id)
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ============================================================
-- RPC atomik: charge (usage) — cek saldo, debit
-- ============================================================
create or replace function public.fn_credit_charge(
  p_user_id uuid,
  p_credits bigint,
  p_ref text default null,
  p_note text default null
) returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id bigint;
  v_new_balance bigint;
  v_tx public.credit_transactions;
begin
  if p_credits <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select id, balance_credits into v_account_id, v_new_balance
  from public.credit_accounts where user_id = p_user_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_new_balance < p_credits then raise exception 'INSUFFICIENT_BALANCE'; end if;

  v_new_balance := v_new_balance - p_credits;
  update public.credit_accounts set balance_credits = v_new_balance, updated_at = now()
  where id = v_account_id;

  insert into public.credit_transactions
    (account_id, type, amount_credits, balance_after, ref, note, created_by)
  values
    (v_account_id, 'usage', -p_credits, v_new_balance, p_ref, p_note, p_user_id)
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ============================================================
-- RPC atomik: adjust (admin top-up/refund) — delta bebas, saldo non-negatif
-- ============================================================
create or replace function public.fn_credit_adjust(
  p_user_id uuid,
  p_delta bigint,
  p_ref text default null,
  p_note text default null
) returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id bigint;
  v_new_balance bigint;
  v_tx public.credit_transactions;
begin
  if p_delta = 0 then raise exception 'INVALID_AMOUNT'; end if;

  insert into public.credit_accounts (user_id) values (p_user_id)
  on conflict (user_id) do update set updated_at = now();

  select id, balance_credits into v_account_id, v_new_balance
  from public.credit_accounts where user_id = p_user_id;

  if v_new_balance + p_delta < 0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
  v_new_balance := v_new_balance + p_delta;
  update public.credit_accounts set balance_credits = v_new_balance, updated_at = now()
  where id = v_account_id;

  insert into public.credit_transactions
    (account_id, type, amount_credits, balance_after, ref, note, created_by)
  values
    (v_account_id, 'adjust', p_delta, v_new_balance, p_ref, p_note, null)
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ============================================================
-- RLS (worker memakai service role → bypass; RLS untuk akses langsung)
-- ============================================================
alter table public.credit_packages enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.ai_jobs enable row level security;

drop policy if exists credit_packages_read on public.credit_packages;
create policy credit_packages_read on public.credit_packages for select using (true);

drop policy if exists credit_accounts_owner on public.credit_accounts;
create policy credit_accounts_owner on public.credit_accounts for select using (auth.uid() = user_id);

drop policy if exists credit_transactions_owner on public.credit_transactions;
create policy credit_transactions_owner on public.credit_transactions for select using (
  auth.uid() = (select user_id from public.credit_accounts where id = account_id)
);

-- Grants RPC (service_role & anon untuk packages read)
grant execute on function public.fn_credit_topup(uuid, bigint, text, text, text) to service_role;
grant execute on function public.fn_credit_charge(uuid, bigint, text, text) to service_role;
grant execute on function public.fn_credit_adjust(uuid, bigint, text, text) to service_role;
