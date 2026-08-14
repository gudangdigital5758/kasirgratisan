-- P2 — perbaikan & persiapan AI (Profitku Cloud, 2026-08-06)
-- 1) Dedupe seed credit_packages (terjadi saat migrasi credit_ledger di re-push).
-- 2) fn_credit_charge dibuat idempotent (p_idempotency_key) untuk debit AI yang aman.

-- ==== 1) Dedupe paket: pertahankan id terkecil per nama ====
delete from public.credit_packages a
using public.credit_packages b
where a.name = b.name and a.id > b.id;

-- Cegah duplikasi ke depan.
create unique index if not exists credit_packages_name_key on public.credit_packages (name);

-- ==== 2) fn_credit_charge idempotent ====
create or replace function public.fn_credit_charge(
  p_user_id uuid,
  p_credits bigint,
  p_ref text default null,
  p_note text default null,
  p_idempotency_key text default null
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

  if p_idempotency_key is not null then
    select * into v_tx from public.credit_transactions where idempotency_key = p_idempotency_key;
    if found then return v_tx; end if;
  end if;

  select id, balance_credits into v_account_id, v_new_balance
  from public.credit_accounts where user_id = p_user_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_new_balance < p_credits then raise exception 'INSUFFICIENT_BALANCE'; end if;

  v_new_balance := v_new_balance - p_credits;
  update public.credit_accounts set balance_credits = v_new_balance, updated_at = now()
  where id = v_account_id;

  insert into public.credit_transactions
    (account_id, type, amount_credits, balance_after, ref, note, idempotency_key, created_by)
  values
    (v_account_id, 'usage', -p_credits, v_new_balance, p_ref, p_note, p_idempotency_key, p_user_id)
  returning * into v_tx;

  return v_tx;
end;
$$;

grant execute on function public.fn_credit_charge(uuid, bigint, text, text, text) to service_role;

-- ==== 3) Indeks pendukung ai_jobs ====
create index if not exists ai_jobs_status_idx on public.ai_jobs (status);
create index if not exists ai_jobs_msc_idx on public.ai_jobs (msc_job_id);
