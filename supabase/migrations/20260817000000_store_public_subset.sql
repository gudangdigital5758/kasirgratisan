-- SEC-004 (2026-08-17): katalog publik hanya kolom subset via view.
-- Policy lama `stores_public_read` membocorkan SELURUH kolom stores (alamat,
-- telepon, koordinat, store_code, shopee/tiktok_url, qris_id) untuk toko dengan
-- is_public=true. Hasil audit: tidak ada client yang membaca stores secara anonim
-- (semua akses via Worker/service role), jadi policy dibuang dan diganti view.

drop policy if exists stores_public_read on public.stores;

create or replace view public.public_stores as
select
  id,
  name,
  identifier,
  is_public,
  province_id,
  province_name,
  city_id,
  city_name,
  district_id,
  district_name,
  qris_id,
  shopee_url,
  tiktok_url,
  created_at
from public.stores
where is_public = true;

grant select on public.public_stores to anon, authenticated;
