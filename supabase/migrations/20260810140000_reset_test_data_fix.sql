-- Fix ONE-OFF reset: PostgREST menolak DELETE tanpa WHERE (kode 21000) di dalam
-- fungsi. Body sama dengan 20260810130000 + `where true` di semua DELETE.
create or replace function public.reset_test_data(p_keep_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  keep_id uuid;
  n bigint;
  r jsonb := '{}'::jsonb;
begin
  select id into keep_id from auth.users where lower(email) = lower(p_keep_email) limit 1;
  if keep_id is null then
    raise exception 'keep_email tidak ditemukan di auth.users';
  end if;

  delete from public.affiliate_commissions where true; get diagnostics n = row_count; r := jsonb_set(r, '{affiliateCommissions}', to_jsonb(n));
  delete from public.affiliates where true;           get diagnostics n = row_count; r := jsonb_set(r, '{affiliates}', to_jsonb(n));
  delete from public.voucher_redemptions where true;  get diagnostics n = row_count; r := jsonb_set(r, '{voucherRedemptions}', to_jsonb(n));
  delete from public.vouchers where true;             get diagnostics n = row_count; r := jsonb_set(r, '{vouchers}', to_jsonb(n));
  delete from public.payments where true;             get diagnostics n = row_count; r := jsonb_set(r, '{payments}', to_jsonb(n));
  delete from public.subscriptions where true;        get diagnostics n = row_count; r := jsonb_set(r, '{subscriptions}', to_jsonb(n));
  delete from public.backups where true;              get diagnostics n = row_count; r := jsonb_set(r, '{backups}', to_jsonb(n));
  delete from public.sync_records where true;         get diagnostics n = row_count; r := jsonb_set(r, '{syncRecords}', to_jsonb(n));
  delete from public.sync_devices where true;         get diagnostics n = row_count; r := jsonb_set(r, '{syncDevices}', to_jsonb(n));
  delete from public.sync_meta where true;            get diagnostics n = row_count; r := jsonb_set(r, '{syncMeta}', to_jsonb(n));
  delete from public.stores where true;               get diagnostics n = row_count; r := jsonb_set(r, '{stores}', to_jsonb(n));
  delete from public.notification_log where true;     get diagnostics n = row_count; r := jsonb_set(r, '{notificationLog}', to_jsonb(n));
  delete from public.admin_audit_log where true;      get diagnostics n = row_count; r := jsonb_set(r, '{adminAuditLog}', to_jsonb(n));
  delete from public.platform_events where true;      get diagnostics n = row_count; r := jsonb_set(r, '{platformEvents}', to_jsonb(n));

  -- Member lain (auth.users → cascade profiles; admin_users cascade).
  delete from auth.users where id <> keep_id;
  get diagnostics n = row_count; r := jsonb_set(r, '{usersDeleted}', to_jsonb(n));

  -- Root affiliate baru milik akun yang dipertahankan (kode unik, tanpa parent).
  insert into public.affiliates (code, name, user_id, referred_by, is_active)
  values ('PROFITKU', coalesce((select name from public.profiles where id = keep_id), 'Profitku'), keep_id, null, true)
  on conflict (upper(code)) do nothing;
  get diagnostics n = row_count; r := jsonb_set(r, '{rootAffiliateCreated}', to_jsonb(n));

  return r;
end;
$$;

revoke all on function public.reset_test_data(text) from public, anon, authenticated;
grant execute on function public.reset_test_data(text) to service_role;
