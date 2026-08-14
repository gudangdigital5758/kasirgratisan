-- Profitku Affiliate — link referral + komisi otomatis
--
-- Alur:
--   1. Admin membuat affiliator (kode unik) → link https://profitku.my.id/join?ref=KODE
--   2. User klik link → POS menyimpan jalur affiliate di localStorage
--   3. Saat checkout/langganan & perpanjangan, payment.raw.affiliateCode diisi
--   4. Setelah payment COMPLETED, Worker mencatat komisi = N% × amount_paid
--   Komisi % diatur di Profitku Admin (platform_settings key 'affiliate').
--   Kanonik: DECISIONS 2026-08-10 — /join?ref= (root /?ref= hanya backward-compat).

-- === Affiliates ===
create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  user_id uuid references public.profiles (id) on delete set null,
  payout_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliates_code_nonempty check (length(trim(code)) >= 4)
);

-- Kode unik case-insensitive (disimpan uppercase di app)
create unique index if not exists affiliates_code_upper_uidx
  on public.affiliates (upper(code));

create index if not exists affiliates_user_idx
  on public.affiliates (user_id);

drop trigger if exists affiliates_updated_at on public.affiliates;
create trigger affiliates_updated_at
  before update on public.affiliates
  for each row execute function public.set_updated_at();

-- === Affiliate commissions ===
create type public.affiliate_commission_status as enum ('earned', 'paid', 'void');

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_paid integer not null default 0 check (amount_paid >= 0),
  rate_percent integer not null default 0 check (rate_percent between 0 and 100),
  commission_idr integer not null default 0 check (commission_idr >= 0),
  status public.affiliate_commission_status not null default 'earned',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Satu komisi per payment (idempotent)
create unique index if not exists affiliate_commissions_payment_uidx
  on public.affiliate_commissions (payment_id);

create index if not exists affiliate_commissions_affiliate_idx
  on public.affiliate_commissions (affiliate_id);
create index if not exists affiliate_commissions_user_idx
  on public.affiliate_commissions (user_id);

-- === Settings default (platform_settings — hanya service role / Worker) ===
insert into public.platform_settings (key, value) values
  ('affiliate', '{
    "enabled": true,
    "commission_percent": 10,
    "attribution_days": 90,
    "min_amount_idr": 0
  }'::jsonb)
on conflict (key) do nothing;

-- === RLS: service role only (RLS on, tanpa policy client) ===
alter table public.affiliates enable row level security;
alter table public.affiliate_commissions enable row level security;

COMMENT ON TABLE public.affiliates IS 'Affiliator Profitku (kode referral + payout)';
COMMENT ON TABLE public.affiliate_commissions IS 'Komisi per payment selesai (earned/paid/void)';
