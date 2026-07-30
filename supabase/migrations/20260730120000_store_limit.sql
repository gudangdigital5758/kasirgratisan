-- Enforce cloud store limits atomically for Worker-created stores.
-- The Worker resolves the user's current entitlement and calls this function
-- with that limit. An advisory transaction lock prevents concurrent requests
-- from creating more stores than the plan permits.

create or replace function public.create_store_with_limit(
  p_user_id uuid,
  p_name text,
  p_max_stores integer
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count integer;
  created_store public.stores;
begin
  if p_max_stores is null or p_max_stores < 1 then
    raise exception 'cloud_store_limit_required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('profitku:store-limit:' || p_user_id::text));

  select count(*)
    into existing_count
    from public.stores
   where user_id = p_user_id;

  if existing_count >= p_max_stores then
    raise exception 'cloud_store_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.stores (user_id, name)
  values (p_user_id, btrim(p_name))
  returning * into created_store;

  return created_store;
end;
$$;

revoke all on function public.create_store_with_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_store_with_limit(uuid, text, integer)
  to service_role;
