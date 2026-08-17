-- BILL-004 (2026-08-17): payout affiliate atomik.
-- Insert baris affiliate_payouts + kunci komisi (payout_id) dalam SATU transaksi,
-- menghilangkan jendela crash antara dua operasi yang bisa menghasilkan payout
-- yatim (payout ada, komisi tidak terikat). Idempotent via unique
-- (affiliate_id, period) + filter komisi payout_id is null.

create or replace function public.fn_affiliate_payout_create(
  p_affiliate_id uuid,
  p_period text,
  p_gross_idr bigint,
  p_tax_rate_percent integer,
  p_tax_idr bigint,
  p_net_idr bigint,
  p_bank jsonb,
  p_commission_ids bigint[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.affiliate_payouts%rowtype;
  v_bound integer;
begin
  if p_commission_ids is null or array_length(p_commission_ids, 1) = 0 then
    raise exception 'no_commissions' using errcode = 'P0001';
  end if;

  -- 1) Insert payout. Unique (affiliate_id, period) → idempotent per periode.
  insert into public.affiliate_payouts (
    affiliate_id, period, gross_idr, tax_rate_percent, tax_idr, net_idr,
    bank_name, bank_account_no, bank_account_name, status, commission_ids
  ) values (
    p_affiliate_id, p_period, p_gross_idr, p_tax_rate_percent, p_tax_idr, p_net_idr,
    p_bank->>'bank_name', p_bank->>'bank_account_no', p_bank->>'bank_account_name',
    'generated', p_commission_ids
  )
  on conflict (affiliate_id, period) do nothing
  returning * into v_payout;

  if v_payout.id is null then
    return jsonb_build_object('skipped', true, 'reason', 'period_exists');
  end if;

  -- 2) Kunci komisi milik affiliate ini, status earned, belum terikat.
  update public.affiliate_commissions
     set payout_id = v_payout.id
   where id = any(p_commission_ids)
     and affiliate_id = p_affiliate_id
     and status = 'earned'
     and payout_id is null;
  get diagnostics v_bound = row_count;

  return jsonb_build_object('ok', true, 'payoutId', v_payout.id, 'bound', v_bound);
end;
$$;

revoke all on function public.fn_affiliate_payout_create(uuid, text, bigint, integer, bigint, bigint, jsonb, bigint[])
  from public, anon, authenticated;
grant execute on function public.fn_affiliate_payout_create(uuid, text, bigint, integer, bigint, bigint, jsonb, bigint[])
  to service_role;

comment on function public.fn_affiliate_payout_create(uuid, text, bigint, integer, bigint, bigint, jsonb, bigint[])
  is 'Atomically creates an affiliate payout and binds its commissions (BILL-004).';
