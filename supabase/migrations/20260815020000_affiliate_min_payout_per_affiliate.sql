-- Profitku Cloud — threshold payout per-mitra (override global min_amount_idr).
-- NULL = ikut platform_settings['affiliate'].min_amount_idr (global).
-- Dipakai: admin mark-paid, cron payout, dashboard mitra (progress).

alter table public.affiliates
  add column if not exists min_amount_idr integer;
