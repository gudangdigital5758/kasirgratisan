-- Profitku Cloud — schema awal (Auth = Supabase Auth)
-- Jalankan via: supabase db push  |  atau SQL Editor di dashboard

-- Extensions
create extension if not exists "pgcrypto";

-- === Profiles (1:1 auth.users) ===
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  picture text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- === Plans (katalog paket langganan) ===
create type public.plan_category as enum ('STORAGE', 'SYNC', 'ADDON');
create type public.plan_interval as enum ('month', 'year');

create table if not exists public.plans (
  id text primary key,
  code text not null unique,
  name text not null,
  category public.plan_category not null,
  price_idr integer not null check (price_idr >= 0),
  interval public.plan_interval not null default 'month',
  storage_limit_mb integer not null default 0,
  max_stores integer,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- === Subscriptions ===
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'expired'
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status public.subscription_status not null default 'active',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  provider text, -- midtrans | xendit | google_play | manual
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end);

-- === Payments ===
create type public.payment_status as enum (
  'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED'
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  plan_id text not null references public.plans (id),
  amount integer not null check (amount >= 0),
  status public.payment_status not null default 'PENDING',
  provider text,
  provider_ref text,
  payment_link text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_provider_ref_idx on public.payments (provider_ref);

-- === Stores ===
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  identifier text unique,
  is_public boolean not null default false,
  address1 text,
  address2 text,
  province_id integer,
  province_name text,
  city_id integer,
  city_name text,
  district_id integer,
  district_name text,
  latitude double precision,
  longitude double precision,
  phone text,
  timezone text default 'Asia/Jakarta',
  operational_hours jsonb,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stores_user_id_idx on public.stores (user_id);

-- === Backups (metadata; file di Cloudflare R2) ===
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid references public.stores (id) on delete set null,
  file_name text not null,
  file_key text not null,
  file_size bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists backups_user_id_idx on public.backups (user_id);

-- === Notification log (Resend / Fonnte audit) ===
create type public.notification_channel as enum ('email', 'whatsapp');

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  channel public.notification_channel not null,
  recipient text not null,
  template text not null,
  status text not null default 'queued',
  provider_ref text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- === Helper: updated_at trigger ===
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

drop trigger if exists stores_updated_at on public.stores;
create trigger stores_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- === Auto-create profile on signup ===
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, picture)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- === Entitlements view (aktif = status + period) ===
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
  (
    select max(pl.max_stores)
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = p.id
      and s.status in ('active', 'trialing')
      and s.current_period_end > now()
      and pl.category = 'SYNC'
  ) as max_stores
from public.profiles p;

-- === RLS ===
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.stores enable row level security;
alter table public.backups enable row level security;
alter table public.notification_log enable row level security;

-- Plans: public read active
create policy "plans_public_read"
  on public.plans for select
  using (is_active = true);

-- Profiles: own row
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Subscriptions / payments / stores / backups: own
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "payments_select_own"
  on public.payments for select
  using (auth.uid() = user_id);

create policy "stores_select_own"
  on public.stores for select
  using (auth.uid() = user_id);

create policy "stores_insert_own"
  on public.stores for insert
  with check (auth.uid() = user_id);

create policy "stores_update_own"
  on public.stores for update
  using (auth.uid() = user_id);

create policy "stores_delete_own"
  on public.stores for delete
  using (auth.uid() = user_id);

create policy "backups_select_own"
  on public.backups for select
  using (auth.uid() = user_id);

-- Public market: stores marked public (read-only subset via RPC later)
create policy "stores_public_read"
  on public.stores for select
  using (is_public = true);

-- Service role (Worker) bypasses RLS automatically.
