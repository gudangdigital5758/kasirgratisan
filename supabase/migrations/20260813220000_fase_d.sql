-- Fase D: Diskon bertingkat per produk (market-only) + link affiliate toko (Shopee/TikTok).

create table if not exists public.price_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_sync_id text not null,
  min_qty integer not null check (min_qty >= 1),
  discount_percent numeric not null check (discount_percent > 0 and discount_percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_sync_id, min_qty)
);

create index if not exists price_rules_store_idx on public.price_rules (store_id);
create index if not exists price_rules_product_idx on public.price_rules (store_id, product_sync_id);

alter table public.stores
  add column if not exists shopee_url text,
  add column if not exists tiktok_url text;