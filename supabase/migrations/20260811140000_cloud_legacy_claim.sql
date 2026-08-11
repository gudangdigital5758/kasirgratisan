-- One-time bridge for account-level subscriptions created before store-scoped billing.
-- The claim is explicit, idempotent, and preserves the original expiry.

create or replace function public.claim_legacy_subscription(
  p_user_id uuid,
  p_store_id uuid,
  p_move_legacy_backups boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_store public.stores%rowtype;
  legacy_sub public.subscriptions%rowtype;
  target_sub public.subscriptions%rowtype;
  plan_limit_mb integer;
  legacy_backup_bytes bigint := 0;
  target_backup_bytes bigint := 0;
  moved_backup_count integer := 0;
begin
  select *
    into target_store
    from public.stores
   where id = p_store_id
     and user_id = p_user_id
   for update;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0001';
  end if;

  select *
    into target_sub
    from public.subscriptions
   where user_id = p_user_id
     and store_id = p_store_id
     and status in ('active', 'trialing')
     and (coalesce(is_lifetime, false) or current_period_end > now())
   order by current_period_end desc
   limit 1
   for update;

  if target_sub.id is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'target_already_subscribed',
      'subscriptionId', target_sub.id,
      'periodEnd', target_sub.current_period_end,
      'isLifetime', target_sub.is_lifetime
    );
  end if;

  select *
    into legacy_sub
    from public.subscriptions
   where user_id = p_user_id
     and store_id is null
     and status in ('active', 'trialing')
     and (coalesce(is_lifetime, false) or current_period_end > now())
   order by current_period_end desc
   limit 1
   for update;

  if legacy_sub.id is null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no_legacy_subscription'
    );
  end if;

  select storage_limit_mb
    into plan_limit_mb
    from public.plans
   where id = legacy_sub.plan_id;

  if p_move_legacy_backups then
    select coalesce(sum(file_size), 0)
      into legacy_backup_bytes
      from public.backups
     where user_id = p_user_id
       and store_id is null;

    select coalesce(sum(file_size), 0)
      into target_backup_bytes
      from public.backups
     where user_id = p_user_id
       and store_id = p_store_id;

    if plan_limit_mb is not null
       and target_backup_bytes + legacy_backup_bytes > plan_limit_mb::bigint * 1024 * 1024 then
      raise exception 'legacy_backup_quota_exceeded' using errcode = 'P0001';
    end if;

    update public.backups
       set store_id = p_store_id,
           updated_at = now()
     where user_id = p_user_id
       and store_id is null;
    get diagnostics moved_backup_count = row_count;
  end if;

  update public.subscriptions
     set store_id = p_store_id,
         updated_at = now()
   where id = legacy_sub.id;

  -- Link historical payments when they already reference this subscription.
  update public.payments
     set store_id = p_store_id,
         updated_at = now()
   where user_id = p_user_id
     and subscription_id = legacy_sub.id
     and store_id is null;

  return jsonb_build_object(
    'claimed', true,
    'subscriptionId', legacy_sub.id,
    'periodEnd', legacy_sub.current_period_end,
    'isLifetime', legacy_sub.is_lifetime,
    'movedBackupCount', moved_backup_count
  );
end;
$$;

revoke all on function public.claim_legacy_subscription(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_legacy_subscription(uuid, uuid, boolean)
  to service_role;

comment on function public.claim_legacy_subscription(uuid, uuid, boolean)
  is 'Explicitly binds one legacy account subscription to an owned store without recharging.';
