-- Batch checkout (Daftar Toko): satu pembayaran, fulfillment beberapa toko.
-- payments.raw.items = [{storeId, action, durationMonths}, ...]; item yang
-- tidak valid saat fulfillment dilewati (validasi ulang ownership + store aktif).

create or replace function public.fulfill_cloud_payment_batch(
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
  items jsonb;
  item jsonb;
  item_store uuid;
  item_months integer;
  current_sub public.subscriptions%rowtype;
  plan_category public.plan_category;
  raw jsonb;
  voucher_type text;
  grant_days integer;
  days integer;
  lifetime boolean := false;
  period_start timestamptz := now();
  period_end timestamptz;
  extension_base timestamptz;
  v_subscription_id uuid;
  fulfilled_count integer := 0;
  first_period_end timestamptz := null;
  first_lifetime boolean := false;
  is_owned boolean;
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

  raw := case when jsonb_typeof(pay.raw) = 'object' then coalesce(pay.raw, '{}'::jsonb) else '{}'::jsonb end;
  items := raw->'items';
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'batch_items_required' using errcode = 'P0001';
  end if;

  -- Idempotent penuh setelah selesai.
  if pay.status = 'COMPLETED' and coalesce(raw->>'batchFulfilled', 'false') = 'true' then
    return jsonb_build_object(
      'alreadyDone', true,
      'fulfilledCount', jsonb_array_length(items),
      'periodEnd', raw->>'periodEnd',
      'isLifetime', coalesce(lower(raw->>'isLifetime') = 'true', false)
    );
  end if;

  select pl.category
    into plan_category
    from public.plans pl
   where pl.id = pay.plan_id
     and pl.is_active = true;

  if not found or plan_category <> 'SYNC'::public.plan_category then
    raise exception 'cloud_plan_invalid' using errcode = 'P0001';
  end if;

  if p_provider_raw is not null then
    raw := raw || jsonb_build_object(lower(p_provider), p_provider_raw);
  end if;
  voucher_type := lower(coalesce(raw->>'voucherType', ''));
  grant_days := case
    when coalesce(raw->>'grantDays', '') ~ '^[0-9]+$' then (raw->>'grantDays')::integer
    else null
  end;
  lifetime := lower(coalesce(raw->>'isLifetime', 'false')) = 'true'
    or voucher_type = 'lifetime';

  for item in select jsonb_array_elements(items) loop
    item_store := nullif(item->>'storeId', '')::uuid;
    if item_store is null then
      continue;
    end if;
    item_months := case when item->>'durationMonths' in ('6', '12') then (item->>'durationMonths')::integer else 1 end;

    -- Validasi ulang ownership (anti penyalahgunaan jika raw diedit).
    select exists(
      select 1 from public.stores s where s.id = item_store and s.user_id = pay.user_id
    ) into is_owned;
    if not is_owned then
      continue;
    end if;

    select *
      into current_sub
      from public.subscriptions
     where user_id = pay.user_id
       and store_id = item_store
       and status in ('active', 'trialing')
     order by current_period_end desc
     limit 1
     for update;

    if lifetime then
      period_end := '2099-12-31T23:59:59.000Z'::timestamptz;
    else
      if voucher_type in ('free_days', 'percent') and grant_days is not null and grant_days > 0 then
        days := grant_days;
      else
        days := item_months * 30;
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
        item_store,
        pay.plan_id,
        'active',
        period_start,
        period_end,
        lifetime,
        p_provider,
        p_provider_ref
      )
      returning id into v_subscription_id;
    end if;

    if first_period_end is null then
      first_period_end := period_end;
    end if;
    fulfilled_count := fulfilled_count + 1;
  end loop;

  if fulfilled_count = 0 then
    raise exception 'batch_no_fulfillable_items' using errcode = 'P0001';
  end if;

  first_lifetime := lifetime;
  raw := raw || jsonb_build_object(
    'periodEnd', first_period_end,
    'isLifetime', first_lifetime,
    'batchFulfilled', true
  );
  update public.payments
     set status = 'COMPLETED',
         provider = p_provider,
         provider_ref = p_provider_ref,
         subscription_id = v_subscription_id,
         raw = raw,
         updated_at = now()
   where id = pay.id;

  return jsonb_build_object(
    'alreadyDone', false,
    'fulfilledCount', fulfilled_count,
    'periodEnd', first_period_end,
    'isLifetime', first_lifetime
  );
end;
$$;
