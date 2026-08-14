-- Fix 2026-08-13: row_to_jsonb hanya ada di PostgreSQL 17; Supabase (PG 15)
-- tidak memilikinya → runtime error 42883 saat fn_report_summary/detail dipanggil.
-- Pengganti: to_jsonb (identik untuk satu record, tersedia di semua versi PG).

create or replace function public.fn_report_summary(
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
  v_tx_count bigint;
  v_revenue numeric;
  v_profit numeric;
  v_daily jsonb;
  v_top jsonb;
begin
  select count(*), coalesce(sum((data->>'total')::numeric), 0), coalesce(sum((data->>'profit')::numeric), 0)
  into v_tx_count, v_revenue, v_profit
  from public.sync_records
  where store_id = p_store_id
    and table_name = 'transactions'
    and not deleted
    and coalesce(data->>'status', 'completed') <> 'void'
    and (data->>'date')::timestamptz between v_from and v_to;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb)
  into v_daily
  from (
    select date_trunc('day', (data->>'date')::timestamptz) as day,
           count(*) as tx_count,
           coalesce(sum((data->>'total')::numeric), 0) as revenue,
           coalesce(sum((data->>'profit')::numeric), 0) as profit
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'transactions'
      and not deleted
      and coalesce(data->>'status', 'completed') <> 'void'
      and (data->>'date')::timestamptz between v_from and v_to
    group by 1
  ) d;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc), '[]'::jsonb)
  into v_top
  from (
    select ti.data->>'productName' as product_name,
           sum((ti.data->>'quantity')::numeric) as qty,
           coalesce(sum((ti.data->>'subtotal')::numeric), 0) as revenue
    from public.sync_records ti
    join public.sync_records tr
      on tr.store_id = p_store_id
     and tr.table_name = 'transactions'
     and not tr.deleted
     and tr.sync_id = ti.data->>'transactionSyncId'
    where ti.store_id = p_store_id
      and ti.table_name = 'transactionItems'
      and not ti.deleted
      and coalesce(tr.data->>'status', 'completed') <> 'void'
      and (tr.data->>'date')::timestamptz between v_from and v_to
    group by 1
    order by 3 desc
    limit 10
  ) t;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'transactions', v_tx_count,
    'revenue', v_revenue,
    'profit', v_profit,
    'daily', v_daily,
    'topProducts', v_top
  );
end;
$$;

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

  select coalesce(jsonb_agg(to_jsonb(p) order by p.name), '[]'::jsonb)
  into v_stock
  from (
    select distinct on (data->>'syncId')
           data->>'name' as name,
           data->>'sku' as sku,
           coalesce((data->>'stock')::numeric, 0) as stock,
           data->>'unit' as unit
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'products'
      and not deleted
    order by data->>'syncId', server_updated_at desc
  ) p;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.remaining desc), '[]'::jsonb)
  into v_debts
  from (
    select distinct on (data->>'syncId')
           data->>'customerName' as customer,
           coalesce((data->>'remainingAmount')::numeric, 0) as remaining,
           data->>'status' as status
    from public.sync_records
    where store_id = p_store_id
      and table_name = 'debts'
      and not deleted
      and coalesce(data->>'status', '') <> 'paid'
    order by data->>'syncId', server_updated_at desc
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

-- Selfcheck sementara (di-drop di migrasi berikutnya setelah diverifikasi):
-- membuktikan kedua fungsi jalan tanpa 42883, bisa dipanggil anon via REST.
create or replace function public.fn_report_selfcheck() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  select public.fn_report_summary('00000000-0000-0000-0000-000000000000', now() - interval '1 day', now()) into r;
  select public.fn_report_detail('00000000-0000-0000-0000-000000000000', now() - interval '1 day', now()) into r;
  return '{"ok":true}'::jsonb;
end;
$$;

grant execute on function public.fn_report_summary(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.fn_report_detail(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.fn_report_selfcheck() to anon;
