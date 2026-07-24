-- Profitku — Admin ops tables (staff RBAC, audit, events, settings)
-- Jalankan via Supabase SQL Editor / db push setelah init.

-- === Staff allowlist (selain ADMIN_EMAILS di Worker env) ===
create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null default 'support'
    check (role in ('superadmin', 'support', 'finance', 'readonly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists admin_users_updated_at on public.admin_users;
create trigger admin_users_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();

-- === Audit mutasi admin ===
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_id_idx
  on public.admin_audit_log (actor_id);

-- === Platform domain events (live activity feed) ===
create table if not exists public.platform_events (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info'
    check (level in ('debug', 'info', 'warn', 'error')),
  source text not null default 'api',
  type text not null,
  message text,
  actor_user_id uuid references public.profiles (id) on delete set null,
  subject_user_id uuid references public.profiles (id) on delete set null,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_events_created_at_idx
  on public.platform_events (created_at desc);
create index if not exists platform_events_type_idx
  on public.platform_events (type);

-- === Key/value ops settings (bukan secrets) ===
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.platform_settings (key, value) values
  ('maintenance_mode', 'false'::jsonb),
  ('dunning_enabled', 'true'::jsonb),
  ('mock_payment_note', '"Checkout mock aktif sampai gateway production."'::jsonb)
on conflict (key) do nothing;

-- RLS: admin tables hanya lewat service role (Worker). Client app user tidak akses.
alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.platform_events enable row level security;
alter table public.platform_settings enable row level security;
-- Tidak ada policy untuk authenticated — service role bypass RLS.
