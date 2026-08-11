-- Cloud scope hardening: sync RPC dan entitlement view hanya boleh dipakai Worker.
-- Worker tetap melakukan validasi auth, ownership, dan entitlement per toko.

revoke all on function public.sync_upsert_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_upsert_batch(uuid, jsonb)
  to service_role;

revoke all on function public.sync_register_device(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sync_register_device(uuid, text, text)
  to service_role;

-- Client cloud menggunakan Worker sebagai boundary resmi. View entitlement
-- tidak boleh dibaca langsung dengan anon/authenticated JWT.
revoke all on public.user_entitlements from anon, authenticated;
revoke all on public.store_entitlements from anon, authenticated;
grant select on public.user_entitlements, public.store_entitlements to service_role;
