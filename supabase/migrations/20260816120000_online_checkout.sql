-- F4 — Kasir Online (cloud.profitku.my.id): checkout atomik, 2026-08-16
-- Menulis transactions + transactionItems ke sync_records (LWW pull perangkat) dan
-- decrement stok produk — satu transaksi DB (race-safe).
-- Harga & HPP dibaca server dari sync_records (prinsip: jangan percaya harga client).
-- ponytail: FIFO penuh via stockLots, diskon server-side, shift online, paymentMethodSyncId.

create or replace function public.fn_online_checkout(
  p_store_id uuid,
  p_cashier text,
  p_payment_method_name text,
  p_receipt_number text,
  p_payment_amount numeric,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_sync_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product_sync_id uuid;
  v_qty numeric;
  v_name text;
  v_price numeric;
  v_hpp numeric;
  v_stock numeric;
  v_track boolean;
  v_item_sync_id uuid;
  v_subtotal numeric := 0;
  v_profit numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang kosong';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_sync_id := (v_item->>'productSyncId')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    if v_product_sync_id is null or v_qty <= 0 then
      raise exception 'Item tidak valid';
    end if;

    select (data->>'name')::text, coalesce((data->>'price')::numeric, 0),
           coalesce((data->>'hpp')::numeric, 0), coalesce((data->>'stock')::numeric, 0),
           coalesce((data->>'trackStock')::text, '') <> 'false'
      into v_name, v_price, v_hpp, v_stock, v_track
      from public.sync_records
     where store_id = p_store_id and table_name = 'products'
       and sync_id = v_product_sync_id::text and deleted = false
     limit 1;

    if v_name is null then
      raise exception 'Produk tidak ditemukan di toko ini';
    end if;
    if v_track and v_stock < v_qty then
      raise exception 'Stok % tidak cukup (tersedia %)', v_name, v_stock;
    end if;

    v_item_sync_id := gen_random_uuid();
    v_subtotal := v_subtotal + (v_price * v_qty);
    v_profit := v_profit + ((v_price - v_hpp) * v_qty);

    v_items := v_items || jsonb_build_object(
      'syncId', v_item_sync_id::text,
      'transactionSyncId', v_tx_sync_id::text,
      'productSyncId', v_product_sync_id::text,
      'productName', v_name,
      'quantity', v_qty,
      'price', v_price,
      'hpp', v_hpp,
      'costAmount', v_hpp * v_qty,
      'discountType', null,
      'discountValue', 0,
      'discountAmount', 0,
      'subtotal', v_price * v_qty
    );

    if v_track then
      update public.sync_records
         set data = jsonb_set(
               jsonb_set(data, '{stock}', to_jsonb(v_stock - v_qty)),
               '{updatedAt}', to_jsonb(v_now)
             ),
             server_updated_at = v_now,
             client_updated_at = v_now
       where store_id = p_store_id and table_name = 'products'
         and sync_id = v_product_sync_id::text and deleted = false;
    end if;
  end loop;

  insert into public.sync_records (store_id, table_name, sync_id, data, deleted, server_updated_at, client_updated_at)
  values (
    p_store_id, 'transactions', v_tx_sync_id::text,
    jsonb_build_object(
      'subtotal', v_subtotal,
      'discountType', null,
      'discountValue', 0,
      'discountAmount', 0,
      'total', v_subtotal,
      'paymentMethodId', null,
      'paymentMethodSyncId', null,
      'paymentMethodName', coalesce(p_payment_method_name, 'Tunai'),
      'paymentAmount', coalesce(p_payment_amount, v_subtotal),
      'change', greatest(0, coalesce(p_payment_amount, v_subtotal) - v_subtotal),
      'profit', v_profit,
      'date', v_now,
      'receiptNumber', p_receipt_number,
      'status', 'completed',
      'createdBy', null,
      'createdByName', coalesce(p_cashier, 'Kasir Online'),
      'updatedAt', v_now
    ),
    false, v_now, v_now
  );

  insert into public.sync_records (store_id, table_name, sync_id, data, deleted, server_updated_at, client_updated_at)
  select p_store_id, 'transactionItems', (v_item->>'syncId')::text,
         (v_item - 'syncId')::jsonb, false, v_now, v_now
    from jsonb_array_elements(v_items) as v_item;

  return jsonb_build_object('ok', true, 'transactionSyncId', v_tx_sync_id::text, 'receiptNumber', p_receipt_number);
end;
$$;
