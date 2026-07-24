-- Profitku Cloud — voucher promo (percent / free_days / lifetime)

-- === Subscriptions: lifetime flag ===
alter table public.subscriptions
  add column if not exists is_lifetime boolean not null default false;

create index if not exists subscriptions_is_lifetime_idx
  on public.subscriptions (user_id)
  where is_lifetime = true;

-- === Voucher types ===
do $$ begin
  create type public.voucher_type as enum ('percent', 'free_days', 'lifetime');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  type public.voucher_type not null,
  -- percent: 1–100; free_days: hari; lifetime: 0 (diabaikan)
  value integer not null default 0,
  plan_id text references public.plans (id) on delete set null,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  max_per_user integer not null default 1 check (max_per_user > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vouchers_code_nonempty check (length(trim(code)) >= 2),
  constraint vouchers_value_ok check (
    (type = 'percent' and value between 1 and 100)
    or (type = 'free_days' and value between 1 and 3650)
    or (type = 'lifetime' and value >= 0)
  )
);

-- Code unique case-insensitive (simpan uppercase di app)
create unique index if not exists vouchers_code_upper_uidx
  on public.vouchers (upper(code));

create index if not exists vouchers_active_idx
  on public.vouchers (is_active, ends_at);

drop trigger if exists vouchers_updated_at on public.vouchers;
create trigger vouchers_updated_at
  before update on public.vouchers
  for each row execute function public.set_updated_at();

create table if not exists public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  amount_before integer,
  amount_after integer,
  effect jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz not null default now()
);

create index if not exists voucher_redemptions_voucher_idx
  on public.voucher_redemptions (voucher_id);
create index if not exists voucher_redemptions_user_idx
  on public.voucher_redemptions (user_id);
create index if not exists voucher_redemptions_payment_idx
  on public.voucher_redemptions (payment_id);

-- === Entitlements: aktif jika lifetime ATAU period_end > now() ===
-- CREATE OR REPLACE tidak boleh menyisip/rename kolom di tengah (error 42P16).
-- Urutan kolom lama dipertahankan; is_lifetime ditambah di akhir.
drop view if exists public.user_entitlements;

create view public.user_entitlements as
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
        and (s.is_lifetime = true or s.current_period_end > now())
        and pl.category = 'STORAGE'
    ),
    0
  )::integer as storage_limit_mb,
  exists (
    select 1
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and (s.is_lifetime = true or s.current_period_end > now())
      and pl.category = 'SYNC'
  ) as has_sync,
  (
    select max(s.current_period_end)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and (s.is_lifetime = true or s.current_period_end > now())
      and pl.category = 'SYNC'
  ) as sync_expiry,
  (
    select max(pl.max_stores)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and (s.is_lifetime = true or s.current_period_end > now())
      and pl.category = 'SYNC'
  ) as max_stores,
  (
    select coalesce(bool_or(s.is_lifetime), false)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and (s.is_lifetime = true or s.current_period_end > now())
      and pl.category = 'SYNC'
  ) as is_lifetime
from public.profiles p;

-- === RLS: staff via service role only; user tidak CRUD voucher langsung ===
alter table public.vouchers enable row level security;
alter table public.voucher_redemptions enable row level security;

-- Tidak ada policy client: akses hanya service role (Worker/admin).
-- (RLS on + no policy = deny for anon/authenticated JWT.)
