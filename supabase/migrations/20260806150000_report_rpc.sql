-- P3 — Laporan merchant (report.profitku.my.id), 2026-08-06
-- Sumber: sync_records (data jsonb hasil sinkronisasi POS).
-- Merchant-scoped via p_store_id; ownership diverifikasi di worker middleware.

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

  select coalesce(jsonb_agg(row_to_jsonb(d) order by d.day), '[]'::jsonb)
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

  select coalesce(jsonb_agg(row_to_jsonb(t) order by t.revenue desc), '[]'::jsonb)
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

grant execute on function public.fn_report_summary(uuid, timestamptz, timestamptz) to service_role;
