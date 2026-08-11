-- Return the actual server winner for every pushed item. This lets a client
-- converge immediately when its local LWW version loses, even if the row's
-- pull cursor has already passed the row ID.

create or replace function public.sync_upsert_batch(p_store_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_client_updated_at timestamptz;
  current_row public.sync_records%rowtype;
  accepted text[] := '{}';
  winners jsonb := '[]'::jsonb;
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
      server_updated_at = case
        when excluded.client_updated_at > coalesce(sync_records.client_updated_at, sync_records.server_updated_at)
          then greatest(now(), sync_records.server_updated_at + interval '1 microsecond')
        else sync_records.server_updated_at
      end;

    select *
      into current_row
      from public.sync_records
     where store_id = p_store_id
       and table_name = item->>'table_name'
       and sync_id = item->>'sync_id';

    accepted := array_append(accepted, item->>'sync_id');
    winners := winners || jsonb_build_array(jsonb_build_object(
      'table', current_row.table_name,
      'syncId', current_row.sync_id,
      'data', current_row.data,
      'updatedAt', current_row.server_updated_at,
      'deleted', current_row.deleted,
      'deletedAt', current_row.deleted_at
    ));
  end loop;
  return jsonb_build_object('accepted', accepted, 'winners', winners);
end;
$$;

revoke all on function public.sync_upsert_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_upsert_batch(uuid, jsonb)
  to service_role;
