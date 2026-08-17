-- FUL-001 (2026-08-17): fix ambiguity `raw` di fulfill_cloud_payment.
--
-- PostgreSQL 15: `update public.payments ... set raw = raw || ...` — RHS `raw`
-- ambigu antara variabel PL/pgSQL `raw jsonb` dan kolom `payments.raw`
-- (error: column reference "raw" is ambiguous), sehingga SELURUH fulfillment
-- error di environment yang dibangun dari migrasi repo.
-- Ditemukan oleh CI db-integration (tests/integration/fulfill-concurrency.mjs).
--
-- Fix minimal: rename variabel `raw` -> `raw_json`. Behavior function TIDAK
-- berubah (hanya nama variabel internal). Idempotent via create or replace;
-- grant/revoke diulang eksplisit (aman di re-run).

create or replace function public.fulfill_cloud_payment(
  p_payment_id uuid,
  p_user_id uuid,
  p_provider text,
  p_provider_ref text,
  p_provider_raw jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments%rowtype;
  current_sub public.subscriptions%rowtype;
  plan_category public.plan_category;
  raw_json jsonb;
  voucher_type text;
  grant_days integer;
  duration_months integer := 1;
  days integer;
  lifetime boolean := false;
  period_start timestamptz := now();
  period_end timestamptz;
  extension_base timestamptz;
  v_subscription_id uuid;
begin
  select *
    into pay
    from public.payments
   where id = p_payment_id
   for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  if pay.user_id <> p_user_id then
    raise exception 'payment_owner_mismatch' using errcode = 'P0001';
  end if;

  if pay.store_id is null then
    raise exception 'store_id_required' using errcode = 'P0001';
  end if;

  select pl.category
    into plan_category
    from public.plans pl
   where pl.id = pay.plan_id
     and pl.is_active = true;

  if not found or plan_category <> 'SYNC'::public.plan_category then
    raise exception 'cloud_plan_invalid' using errcode = 'P0001';
  end if;

  -- A completed payment with a linked subscription is fully idempotent.
  -- A legacy completed payment without subscription_id is repaired below.
  if pay.status = 'COMPLETED' and pay.subscription_id is not null then
    return jsonb_build_object(
      'alreadyDone', true,
      'subscriptionId', pay.subscription_id,
      'periodEnd', pay.raw->>'periodEnd',
      'isLifetime', coalesce(lower(pay.raw->>'isLifetime') = 'true', false)
    );
  end if;

  select *
    into current_sub
    from public.subscriptions
   where user_id = pay.user_id
     and store_id = pay.store_id
     and status in ('active', 'trialing')
   order by current_period_end desc
   limit 1
   for update;

  raw_json := case when jsonb_typeof(pay.raw) = 'object' then coalesce(pay.raw, '{}'::jsonb) else '{}'::jsonb end;
  if p_provider_raw is not null then
    raw_json := raw_json || jsonb_build_object(lower(p_provider), p_provider_raw);
  end if;
  voucher_type := lower(coalesce(raw_json->>'voucherType', ''));
  grant_days := case
    when coalesce(raw_json->>'grantDays', '') ~ '^[0-9]+$' then (raw_json->>'grantDays')::integer
    else null
  end;

  lifetime := lower(coalesce(raw_json->>'isLifetime', 'false')) = 'true'
    or voucher_type = 'lifetime'
    or coalesce(current_sub.is_lifetime, false);

  if lifetime then
    period_end := '2099-12-31T23:59:59.000Z'::timestamptz;
  else
    if voucher_type in ('free_days', 'percent') and grant_days is not null and grant_days > 0 then
      days := grant_days;
    else
      duration_months := case
        when raw_json->>'durationMonths' in ('6', '12') then (raw_json->>'durationMonths')::integer
        else 1
      end;
      days := duration_months * 30;
    end if;

    if current_sub.id is null then
      extension_base := period_start;
    else
      extension_base := greatest(period_start, current_sub.current_period_end);
    end if;
    period_end := extension_base + make_interval(days => days);
  end if;

  if current_sub.id is not null then
    v_subscription_id := current_sub.id;
    update public.subscriptions
       set plan_id = pay.plan_id,
           status = 'active',
           current_period_start = coalesce(current_period_start, period_start),
           current_period_end = period_end,
           is_lifetime = lifetime,
           provider = p_provider,
           provider_ref = p_provider_ref,
           updated_at = period_start
     where id = current_sub.id;
  else
    insert into public.subscriptions (
      user_id,
      store_id,
      plan_id,
      status,
      current_period_start,
      current_period_end,
      is_lifetime,
      provider,
      provider_ref
    ) values (
      pay.user_id,
      pay.store_id,
      pay.plan_id,
      'active',
      period_start,
      period_end,
      lifetime,
      p_provider,
      p_provider_ref
    ) returning id into v_subscription_id;
  end if;

  update public.payments
     set status = 'COMPLETED',
         provider = p_provider,
         provider_ref = p_provider_ref,
         subscription_id = v_subscription_id,
         raw = raw_json || jsonb_build_object(
           'fulfilledAt', period_start,
           'periodEnd', period_end,
           'isLifetime', lifetime
         ),
         updated_at = period_start
   where id = pay.id;

  return jsonb_build_object(
    'alreadyDone', false,
    'subscriptionId', v_subscription_id,
    'periodEnd', period_end,
    'isLifetime', lifetime
  );
end;
$$;

revoke all on function public.fulfill_cloud_payment(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fulfill_cloud_payment(uuid, uuid, text, text, jsonb)
  to service_role;

comment on function public.fulfill_cloud_payment(uuid, uuid, text, text, jsonb)
  is 'Atomically fulfills one per-store cloud payment and creates or extends its subscription.';
