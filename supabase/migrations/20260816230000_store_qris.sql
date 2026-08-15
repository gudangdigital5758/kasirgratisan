-- QRIS statis toko (ditampilkan saat pembayaran di kasir online), 2026-08-16
alter table public.stores
  add column if not exists qris_id text;
