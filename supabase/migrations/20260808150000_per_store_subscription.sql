-- Profitku Cloud — langganan PER TOKO (unlimited) + durasi diskon + storage per toko
--
-- Keputusan 2026-08-08 (docs/DECISIONS.md):
--  1. Unlimited toko cloud; Rp 25.000/bulan PER TOKO (unit lisensi = toko).
--  2. Durasi langganan: 1 bln (25rb) · 6 bln = bayar 5 (125rb) · 12 bln = bayar 10 (250rb).
--  3. Perpanjangan per toko; toko tidak diperpanjang → offline + backup terakhir ke device.
--  4. Kuota penyimpanan per toko (1024 MB per langganan toko).
--  5. Auto-sync (client-side).

-- === subscriptions: unit lisensi per toko ===
alter table public.subscriptions
  add column if not exists store_id uuid references public.stores (id) on delete cascade;

create index if not exists subscriptions_store_id_idx
  on public.subscriptions (store_id);

-- === payments: ikat ke toko ===
alter table public.payments
  add column if not exists store_id uuid references public.stores (id) on delete set null;

create index if not exists payments_store_id_idx
  on public.payments (store_id);

-- === create store TANPA batas (model per-toko berbayar) ===
-- p_max_stores = NULL → unlimited (semua user boleh buat toko; cloud-sync
-- ditentukan oleh langganan per toko, bukan jumlah toko).
create or replace function public.create_store_with_limit(
  p_user_id uuid,
  p_name text,
  p_max_stores integer
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  created_store public.stores;
begin
  -- Nilai angka (legacy) tetap di-enforce; NULL = unlimited.
  if p_max_stores is not null and p_max_stores < 1 then
    raise exception 'cloud_store_limit_required' using errcode = 'P0001';
  end if;

  if p_max_stores is not null then
    perform pg_advisory_xact_lock(hashtext('profitku:store-limit:' || p_user_id::text));
    if (select count(*) from public.stores where user_id = p_user_id) >= p_max_stores then
      raise exception 'cloud_store_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  insert into public.stores (user_id, name)
  values (p_user_id, btrim(p_name))
  returning * into created_store;

  return created_store;
end;
$$;

revoke all on function public.create_store_with_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_store_with_limit(uuid, text, integer)
  to service_role;

-- === Plan: storage per toko 1024 MB (selaras BRAND.cloudStorageMb) ===
update public.plans
set storage_limit_mb = 1024
where id = 'cloud_monthly'
  and storage_limit_mb <> 1024;

-- === user_entitlements (legacy akun): has_sync = ada ≥1 langganan toko aktif;
--     max_stores = NULL (unlimited); storage = jumlah plan aktif (SYNC+STORAGE) ===
create or replace view public.user_entitlements as
select
  p.id as user_id,
  p.email,
  p.name,
  p.picture,
  coalesce(
    (
      select sum(pl.storage_limit_mb)
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.user_id = p.id
        and s.status in ('active', 'trialing')
        and s.current_period_end > now()
        and pl.category in ('STORAGE', 'SYNC')
    ),
    0
  )::integer as storage_limit_mb,
  exists (
    select 1
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and s.current_period_end > now()
      and pl.category = 'SYNC'
  ) as has_sync,
  (
    select max(s.current_period_end)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and s.current_period_end > now()
      and pl.category = 'SYNC'
  ) as sync_expiry,
  null::integer as max_stores,
  (
    select bool_or(coalesce(s.is_lifetime, false))
    from public.subscriptions s
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
  ) as is_lifetime
from public.profiles p;

-- === store_entitlements: entitlement per toko (sumber utama UI baru) ===
create or replace view public.store_entitlements as
select
  st.id as store_id,
  st.user_id,
  st.name as store_name,
  st.is_public,
  exists (
    select 1
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.store_id = st.id
      and s.status in ('active', 'trialing')
      and s.current_period_end > now()
      and pl.category = 'SYNC'
  ) as has_sync,
  (
    select max(s.current_period_end)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.store_id = st.id
      and s.status in ('active', 'trialing')
      and s.current_period_end > now()
      and pl.category = 'SYNC'
  ) as sync_expiry,
  (
    select bool_or(coalesce(s.is_lifetime, false))
    from public.subscriptions s
    where s.store_id = st.id
      and s.status in ('active', 'trialing')
  ) as is_lifetime,
  coalesce(
    (
      select pl.storage_limit_mb
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.store_id = st.id
        and s.status in ('active', 'trialing')
        and s.current_period_end > now()
        and pl.category = 'SYNC'
      order by s.current_period_end desc
      limit 1
    ),
    0
  )::integer as storage_limit_mb,
  (
    select coalesce(sum(b.file_size), 0)::bigint
    from public.backups b
    where b.store_id = st.id
  ) as backup_bytes
from public.stores st;

COMMENT ON COLUMN public.subscriptions.store_id IS 'Toko yang dilanggani (unit lisensi per toko; NULL = legacy akun)';
COMMENT ON COLUMN public.payments.store_id IS 'Toko tujuan pembayaran (perpanjangan/aktivasi)';
COMMENT ON VIEW public.store_entitlements IS 'Entitlement sinkronisasi + kuota per toko (sumber UI baru)';
