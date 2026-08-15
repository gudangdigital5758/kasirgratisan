-- v2 Finance lanjutan: Shift Online (tutup shift atomik) + Laba-Rugi (P&L), 2026-08-16

-- === Tutup shift (atomik): agregasi transaksi & pengeluaran sejak shift dibuka ===
-- Approksimasi v1 (dicatat): cashSales = transaksi dengan metode bayar Tunai/Cash/kosong;
-- cashExpenses = SEMUA pengeluaran sejak buka (tanpa filter metode). FIFO/lot tidak dihitung di sini.
create or replace function public.fn_online_close_shift(
  p_store_id uuid,
  p_shift_sync_id text,
  p_closing_cash numeric,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.sync_records%rowtype;
  v_opened timestamptz;
  v_cash_sales numeric := 0;
  v_cash_expenses numeric := 0;
  v_sales_total numeric := 0;
  v_tx_count int := 0;
  v_expected numeric;
  v_now timestamptz := now();
begin
  select * into v_shift from public.sync_records
   where store_id = p_store_id and table_name = 'cashierShifts'
     and sync_id = p_shift_sync_id and deleted = false
   limit 1;
  if v_shift.sync_id is null then
    raise exception 'Shift tidak ditemukan';
  end if;
  if (v_shift.data->>'status') <> 'open' then
    raise exception 'Shift sudah ditutup';
  end if;
  if p_closing_cash < 0 then
    raise exception 'Uang tunai tidak valid';
  end if;
  v_opened := coalesce((v_shift.data->>'openedAt')::timestamptz, v_shift.server_updated_at);

  select coalesce(sum((data->>'total')::numeric), 0), count(*),
         coalesce(sum(
           case when lower(coalesce((data->>'paymentMethodName')::text, 'tunai')) in ('tunai', 'cash', '')
             then (data->>'total')::numeric else 0 end
         ), 0)
    into v_sales_total, v_tx_count, v_cash_sales
    from public.sync_records
   where store_id = p_store_id and table_name = 'transactions' and deleted = false
     and coalesce((data->>'status')::text, 'completed') <> 'open'
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end >= v_opened;

  select coalesce(sum((data->>'amount')::numeric), 0)
    into v_cash_expenses
    from public.sync_records
   where store_id = p_store_id and table_name = 'expenses' and deleted = false
     and coalesce((data->>'isDeleted')::text, '0') <> '1'
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end >= v_opened;

  v_expected := coalesce((v_shift.data->>'openingCash')::numeric, 0) + v_cash_sales - v_cash_expenses;

  update public.sync_records
     set data = jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(v_shift.data, '{status}', to_jsonb('closed')),
                     '{closedAt}', to_jsonb(v_now)
                   ),
                   '{closingCash}', to_jsonb(coalesce(p_closing_cash, v_expected))
                 ),
                 '{expectedCash}', to_jsonb(v_expected)
               ),
               '{cashSales}', to_jsonb(v_cash_sales)
             ),
             '{cashExpenses}', to_jsonb(v_cash_expenses)
           ),
           '{txCount}', to_jsonb(v_tx_count)
         ) || jsonb_build_object(
           'salesTotal', v_sales_total,
           'notes', coalesce(p_notes, ''),
           'updatedAt', v_now
         ),
         server_updated_at = v_now,
         client_updated_at = v_now
   where id = v_shift.id;

  return jsonb_build_object(
    'ok', true,
    'expectedCash', v_expected,
    'salesTotal', v_sales_total,
    'txCount', v_tx_count,
    'cashSales', v_cash_sales,
    'cashExpenses', v_cash_expenses
  );
end;
$$;

-- === Laba-Rugi periode (P&L): omzet, laba kotor, pengeluaran, laba bersih ===
create or replace function public.fn_online_pnl(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revenue numeric := 0;
  v_profit numeric := 0;
  v_tx int := 0;
  v_expenses numeric := 0;
  v_exp int := 0;
begin
  select coalesce(sum((data->>'total')::numeric), 0),
         coalesce(sum((data->>'profit')::numeric), 0),
         count(*)
    into v_revenue, v_profit, v_tx
    from public.sync_records
   where store_id = p_store_id and table_name = 'transactions' and deleted = false
     and coalesce((data->>'status')::text, 'completed') <> 'open'
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end >= p_from
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end < p_to;

  select coalesce(sum((data->>'amount')::numeric), 0), count(*)
    into v_expenses, v_exp
    from public.sync_records
   where store_id = p_store_id and table_name = 'expenses' and deleted = false
     and coalesce((data->>'isDeleted')::text, '0') <> '1'
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end >= p_from
     and case when (data->>'date') ~ '^[0-9]{4}-'
              then (data->>'date')::timestamptz else server_updated_at end < p_to;

  return jsonb_build_object(
    'revenue', v_revenue,
    'profit', v_profit,
    'cogs', v_revenue - v_profit,
    'expenses', v_expenses,
    'net', v_profit - v_expenses,
    'txCount', v_tx,
    'expenseCount', v_exp
  );
end;
$$;
