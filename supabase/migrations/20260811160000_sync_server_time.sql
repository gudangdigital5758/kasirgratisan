-- Sync protocol hardening:
-- - client_updated_at = timestamp used only for LWW comparison
-- - server_updated_at = monotonic server-side revision timestamp used by pull cursor

alter table public.sync_records
  add column if not exists client_updated_at timestamptz;

update public.sync_records
set client_updated_at = server_updated_at
where client_updated_at is null;

alter table public.sync_records
  alter column client_updated_at set not null;

create index if not exists sync_records_client_updated_idx
  on public.sync_records (store_id, client_updated_at);

create or replace function public.sync_upsert_batch(p_store_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_client_updated_at timestamptz;
  current_client_updated_at timestamptz;
  accepted text[] := '{}';
begin
  for item in select jsonb_array_elements(p_items)
  loop
    item_client_updated_at := (item->>'updated_at')::timestamptz;

    insert into public.sync_records (
      store_id,
      table_name,
      sync_id,
      data,
      server_updated_at,
      client_updated_at,
      deleted,
      deleted_at
    )
    values (
      p_store_id,
      item->>'table_name',
      item->>'sync_id',
      coalesce(item->'data', '{}'::jsonb),
      now(),
      item_client_updated_at,
      coalesce((item->>'deleted')::boolean, false),
      (item->>'deleted_at')::timestamptz
    )
    on conflict (store_id, table_name, sync_id)
    do update set
      data = case
        when excluded.client_updated_at > coalesce(sync_records.client_updated_at, sync_records.server_updated_at)
          then excluded.data
        else sync_records.data
      end,
      deleted = case
        when excluded.client_updated_at > coalesce(sync_records.client_updated_at, sync_records.server_updated_at)
          then excluded.deleted
        else sync_records.deleted
      end,
      deleted_at = case
        when excluded.client_updated_at > coalesce(sync_records.client_updated_at, sync_records.server_updated_at)
          then excluded.deleted_at
        else sync_records.deleted_at
      end,
      client_updated_at = greatest(
        coalesce(sync_records.client_updated_at, sync_records.server_updated_at),
        excluded.client_updated_at
      ),
      -- Every accepted LWW update gets a strictly newer pull revision, even
      -- when multiple updates occur within the same transaction timestamp.
      server_updated_at = case
        when excluded.client_updated_at > coalesce(sync_records.client_updated_at, sync_records.server_updated_at)
          then greatest(now(), sync_records.server_updated_at + interval '1 microsecond')
        else sync_records.server_updated_at
      end;

    accepted := array_append(accepted, item->>'sync_id');
  end loop;
  return to_jsonb(accepted);
end;
$$;

revoke all on function public.sync_upsert_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_upsert_batch(uuid, jsonb)
  to service_role;
