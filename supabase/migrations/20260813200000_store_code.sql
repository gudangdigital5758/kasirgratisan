-- ID Toko (store_code): unik global, dipakai login tim (ID Toko + username + PIN).
-- Format 4-8 karakter huruf/angka tanpa ambigu (O/0, I/1 dihindari).

alter table public.stores
  add column if not exists store_code text;

create unique index if not exists stores_store_code_uidx
  on public.stores (upper(store_code))
  where store_code is not null;