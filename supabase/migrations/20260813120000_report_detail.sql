-- Fase B — Laporan merchant detail (dashboard cloud.profitku.my.id), 2026-08-13
-- Tambahan di atas fn_report_summary (2026-08-06): per kasir (via shift),
-- stok terkini, hutang, dan info sync terakhir. Sumber: sync_records.
-- Catatan: agregasi per kategori TIDAK bisa dari sync data saat ini —
-- products.categoryId lokal tanpa categorySyncId (lihat DECISIONS/plan Fase B).

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
  -- Per kasir: nama kasir tersedia di cashierShifts (users tidak membawa id lokal).
  select coalesce(jsonb_agg(row_to_jsonb(s) order by s.revenue desc), '[]'::jsonb)
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

  -- Stok terkini: snapshot LWW terbaru per produk (bukan total history).
  select coalesce(jsonb_agg(row_to_jsonb(p) order by p.name), '[]'::jsonb)
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

  -- Hutang belum lunas: snapshot terakhir per debt.
  select coalesce(jsonb_agg(row_to_jsonb(d) order by d.remaining desc), '[]'::jsonb)
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

grant execute on function public.fn_report_detail(uuid, timestamptz, timestamptz) to service_role;
