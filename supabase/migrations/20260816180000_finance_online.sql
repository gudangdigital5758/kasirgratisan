-- v2 Finance Online (cloud.profitku.my.id), 2026-08-16
-- RPC pembayaran hutang + stok masuk/keluar (atomik, race-safe) + menu 'finance'.

-- === Pembayaran hutang (atomik): update remaining/status + catat debtPayments ===
create or replace function public.fn_online_debt_payment(
  p_store_id uuid,
  p_debt_sync_id text,
  p_amount numeric,
  p_method text,
  p_notes text,
  p_created_by text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt public.sync_records%rowtype;
  v_remaining numeric;
  v_new_remaining numeric;
  v_status text;
  v_payment_sync_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  select * into v_debt from public.sync_records
   where store_id = p_store_id and table_name = 'debts'
     and sync_id = p_debt_sync_id and deleted = false
   limit 1;
  if v_debt.sync_id is null then
    raise exception 'Hutang tidak ditemukan';
  end if;
  v_remaining := coalesce((v_debt.data->>'remainingAmount')::numeric, (v_debt.data->>'originalAmount')::numeric, 0);
  if p_amount <= 0 then
    raise exception 'Jumlah bayar harus lebih dari 0';
  end if;
  if p_amount > v_remaining then
    raise exception 'Jumlah bayar melebihi sisa hutang (sisa %)', v_remaining;
  end if;
  v_new_remaining := v_remaining - p_amount;
  v_status := case when v_new_remaining <= 0 then 'settled' else 'active' end;

  update public.sync_records
     set data = jsonb_set(
           jsonb_set(
             jsonb_set(data, '{remainingAmount}', to_jsonb(v_new_remaining)),
             '{status}', to_jsonb(v_status)
           ),
           '{updatedAt}', to_jsonb(v_now)
         ) || case when v_status = 'settled' then jsonb_build_object('settledAt', v_now) else '{}'::jsonb end,
         server_updated_at = v_now,
         client_updated_at = v_now
   where id = v_debt.id;

  insert into public.sync_records (store_id, table_name, sync_id, data, deleted, server_updated_at, client_updated_at)
  values (
    p_store_id, 'debtPayments', v_payment_sync_id::text,
    jsonb_build_object(
      'debtId', null,
      'debtSyncId', p_debt_sync_id,
      'amount', p_amount,
      'paymentMethodId', null,
      'paymentMethodSyncId', null,
      'paymentMethodName', coalesce(p_method, 'Tunai'),
      'date', v_now,
      'notes', coalesce(p_notes, ''),
      'createdBy', null,
      'createdByName', coalesce(p_created_by, 'Kasir Online'),
      'updatedAt', v_now
    ),
    false, v_now, v_now
  );

  return jsonb_build_object('ok', true, 'remainingAmount', v_new_remaining, 'status', v_status);
end;
$$;

-- === Stok masuk/keluar (atomik): update stok produk + catat stockIns/stockOuts ===
create or replace function public.fn_online_stock_move(
  p_store_id uuid,
  p_type text,
  p_product_sync_id text,
  p_qty numeric,
  p_buy_price numeric,
  p_reason text,
  p_notes text,
  p_created_by text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.sync_records%rowtype;
  v_name text;
  v_stock numeric;
  v_track boolean;
  v_sync_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_data jsonb;
begin
  if p_type not in ('in', 'out') then
    raise exception 'Tipe stok harus in/out';
  end if;
  if p_qty <= 0 then
    raise exception 'Jumlah harus lebih dari 0';
  end if;
  select * into v_prod from public.sync_records
   where store_id = p_store_id and table_name = 'products'
     and sync_id = p_product_sync_id and deleted = false
   limit 1;
  if v_prod.sync_id is null then
    raise exception 'Produk tidak ditemukan di toko ini';
  end if;
  v_name := v_prod.data->>'name';
  v_stock := coalesce((v_prod.data->>'stock')::numeric, 0);
  v_track := coalesce((v_prod.data->>'trackStock')::text, '') <> 'false';

  if p_type = 'out' and v_track and v_stock < p_qty then
    raise exception 'Stok % tidak cukup (tersedia %)', v_name, v_stock;
  end if;

  if v_track then
    update public.sync_records
       set data = jsonb_set(
             jsonb_set(data, '{stock}', to_jsonb(v_stock + case when p_type = 'in' then p_qty else -p_qty end)),
             '{updatedAt}', to_jsonb(v_now)
           ),
           server_updated_at = v_now,
           client_updated_at = v_now
     where id = v_prod.id;
  end if;

  if p_type = 'in' then
    v_data := jsonb_build_object(
      'productId', null,
      'supplierId', null,
      'productSyncId', p_product_sync_id,
      'supplierSyncId', null,
      'quantity', p_qty,
      'buyPrice', coalesce(p_buy_price, 0),
      'totalPrice', coalesce(p_buy_price, 0) * p_qty,
      'date', v_now,
      'notes', coalesce(p_notes, ''),
      'createdBy', null,
      'createdByName', coalesce(p_created_by, 'Kasir Online'),
      'updatedAt', v_now
    );
  else
    v_data := jsonb_build_object(
      'productId', null,
      'productSyncId', p_product_sync_id,
      'quantity', p_qty,
      'reason', coalesce(p_reason, ''),
      'date', v_now,
      'notes', coalesce(p_notes, ''),
      'createdBy', null,
      'createdByName', coalesce(p_created_by, 'Kasir Online'),
      'updatedAt', v_now
    );
  end if;

  insert into public.sync_records (store_id, table_name, sync_id, data, deleted, server_updated_at, client_updated_at)
  values (
    p_store_id,
    case when p_type = 'in' then 'stockIns' else 'stockOuts' end,
    v_sync_id::text,
    v_data,
    false, v_now, v_now
  );

  return jsonb_build_object(
    'ok', true,
    'stock', case when v_track then v_stock + case when p_type = 'in' then p_qty else -p_qty end else v_stock end
  );
end;
$$;

-- Menu 'finance' (Keuangan) untuk role bawaan admin & kepala_gudang (semua toko).
update public.cloud_team_roles
   set menus = case when menus @> array['finance'] then menus else menus || array['finance'] end,
       updated_at = now()
 where key in ('admin', 'kepala_gudang')
   and not (menus @> array['finance']);
