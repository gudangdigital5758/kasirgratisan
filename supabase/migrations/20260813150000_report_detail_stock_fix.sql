-- Fix 2026-08-13: distinct on salah kolom — syncId TIDAK ada di dalam data
-- (yang ada hanya kolom row sync_id), sehingga stok/hutang menyusut jadi 1 baris.
-- Ganti ke distinct on (sync_id) + order sync_id, server_updated_at desc.

create or replace function public.fn_report_detail(
  p_store_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_by_cashier jsonb;
  v_stock jsonb;
  v_debts jsonb;
  v_last_sync jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(s) order by s.revenue desc), '[]'::jsonb)
  into v_by_cashier
  from (
    select data->>'userName' as cashier,
           count(*) as shifts,
           coalesce(sum((data->>'txCount')::int), 0) as tx_count,
           coalesce(sum((data->>'salesTotal')::numeric), 0) as revenue
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'cashierShifts'
      and not deleted
      and coalesce(data->>'closedAt', data->>'openedAt')::timestamptz between v_from and v_to
    group by 1
  ) s;

  -- Stok terkini: snapshot LWW terbaru per produk (distinct on kolom sync_id).
  select coalesce(jsonb_agg(to_jsonb(p) order by p.name), '[]'::jsonb)
  into v_stock
  from (
    select distinct on (sync_id)
           data->>'name' as name,
           data->>'sku' as sku,
           coalesce((data->>'stock')::numeric, 0) as stock,
           data->>'unit' as unit
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'products'
      and not deleted
    order by sync_id, server_updated_at desc
  ) p;

  -- Hutang belum lunas: snapshot terakhir per debt (distinct on kolom sync_id).
  select coalesce(jsonb_agg(to_jsonb(d) order by d.remaining desc), '[]'::jsonb)
  into v_debts
  from (
    select distinct on (sync_id)
           data->>'customerName' as customer,
           coalesce((data->>'remainingAmount')::numeric, 0) as remaining,
           data->>'status' as status
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'debts'
      and not deleted
      and coalesce(data->>'status', '') <> 'paid'
    order by sync_id, server_updated_at desc
  ) d;

  select jsonb_build_object('lastPushAt', last_push_at, 'deviceCount', device_count)
  into v_last_sync
  from public.sync_meta
  where store_id = p_store_id;

  return jsonb_build_object(
    'byCashier', v_by_cashier,
    'stock', v_stock,
    'debts', v_debts,
    'lastSync', v_last_sync
  );
end;
$$;

grant execute on function public.fn_report_detail(uuid, timestamptz, timestamptz) to service_role;
