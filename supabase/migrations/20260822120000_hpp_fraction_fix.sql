-- FIX HPP DESIMAL (audit 2026-08-22) - STATUS: DIEKSEKUSI ke produksi 2026-08-22
-- (via Supabase Management API; verifikasi pasca: kedua RPC memuat round(),
--  sisa products pecahan = 0; pre-count juga 0). Idempotent -- aman re-run.
--
-- Latar: nilai pecahan (mis. 10333.567) sempat lolos tersimpan di
-- sync_records.data (jsonb). Worker kini memvalidasi & membulatkan di trust
-- boundary (toRupiah, workers/api/src/lib/money.ts). Migrasi ini:
--   1) Defence-in-depth: round() saat RPC membaca harga/HPP produk
--      (fn_online_checkout) dan saat menerima buyPrice (fn_online_stock_move);
--   2) Pembersihan sekali: bulatkan price/hpp pecahan yang sudah tersimpan.
-- Catatan LWW: server_updated_at baris yang dibersihkan SENGAJA tidak diubah
-- agar tidak memicu pull massal perangkat (koreksi nilai di sumber saja).
-- Idempotent: aman dijalankan ulang.

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

    select (data->>'name')::text, -- round(): defence-in-depth thd nilai pecahan eksisting di jsonb.
    round(coalesce((data->>'price')::numeric, 0)),
           round(coalesce((data->>'hpp')::numeric, 0)), coalesce((data->>'stock')::numeric, 0),
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
      -- round(): buyPrice selalu integer rupiah.
      'buyPrice', round(coalesce(p_buy_price, 0)),
      'totalPrice', round(coalesce(p_buy_price, 0)) * p_qty,
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


-- === 2) Pembersihan sekali: bulatkan price/hpp pecahan yang sudah tersimpan ===
update public.sync_records
   set data = jsonb_set(
         jsonb_set(
           data,
           '{price}',
           to_jsonb(round((data->>'price')::numeric))
         ),
         '{hpp}',
         to_jsonb(round((data->>'hpp')::numeric))
       )
 where table_name = 'products'
   and deleted = false
   and ( (jsonb_typeof(data->'price') = 'number' and (data->>'price')::numeric % 1 <> 0)
      or (jsonb_typeof(data->'hpp')  = 'number' and (data->>'hpp')::numeric  % 1 <> 0) );

-- Verifikasi pasca-migrasi: angka yang dicetak harus 0.
do $$
declare v_sisa int;
begin
  select count(*) into v_sisa
    from public.sync_records
   where table_name = 'products'
     and deleted = false
     and ( (jsonb_typeof(data->'price') = 'number' and (data->>'price')::numeric % 1 <> 0)
        or (jsonb_typeof(data->'hpp')  = 'number' and (data->>'hpp')::numeric  % 1 <> 0) );
  raise notice 'Sisa products dengan price/hpp pecahan: % (harus 0)', v_sisa;
end $$;
