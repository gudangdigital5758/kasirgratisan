-- Profitku Cloud — payout komisi affiliate bulanan (Level 1) + PPh 23.
-- Alur: cron/admin run → baris affiliate_payouts (status generated) →
-- admin transfer manual → confirm → komisi di-set paid.
-- Idempotent per (affiliate_id, period). Komisi dikunci lewat payout_id
-- (set null otomatis saat payout dibatalkan → kembali ke pool earned).

alter table public.affiliates
  add column if not exists has_npwp boolean not null default false;

create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  period text not null,
  gross_idr integer not null default 0,
  tax_rate_percent integer not null default 2,
  tax_idr integer not null default 0,
  net_idr integer not null default 0,
  bank_name text,
  bank_account_no text,
  bank_account_name text,
  status text not null default 'generated'
    check (status in ('generated', 'paid', 'cancelled')),
  commission_ids jsonb not null default '[]'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint affiliate_payouts_period_unique unique (affiliate_id, period)
);

create index if not exists affiliate_payouts_status_period_idx
  on public.affiliate_payouts (status, period);

alter table public.affiliate_commissions
  add column if not exists payout_id uuid
    references public.affiliate_payouts (id) on delete set null;

create index if not exists affiliate_commissions_payout_idx
  on public.affiliate_commissions (payout_id);

-- RLS on tanpa policy = akses hanya service role (Worker/admin), sama seperti vouchers.
alter table public.affiliate_payouts enable row level security;
