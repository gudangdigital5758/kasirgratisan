-- Seed paket langganan Profitku — single plan Rp 25.000/bulan
-- Nonaktifkan paket lama multi-tier (jika pernah di-seed).

update public.plans
set is_active = false
where id not in ('cloud_monthly');

insert into public.plans (
  id, code, name, category, price_idr, interval,
  storage_limit_mb, max_stores, features, is_active, sort_order
)
values (
  'cloud_monthly',
  'cloud_monthly',
  'Profitku Cloud',
  'SYNC',
  25000,
  'month',
  2048,
  1,
  '{
    "cloud_backup": true,
    "auto_backup": true,
    "sync": true,
    "hide_watermark": true,
    "storage_mb": 2048,
    "max_stores": 1
  }'::jsonb,
  true,
  10
)
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code,
  category = excluded.category,
  price_idr = excluded.price_idr,
  interval = excluded.interval,
  storage_limit_mb = excluded.storage_limit_mb,
  max_stores = excluded.max_stores,
  features = excluded.features,
  is_active = true,
  sort_order = excluded.sort_order;
