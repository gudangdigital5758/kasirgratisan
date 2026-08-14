-- Profitku Cloud — threshold payout komisi affiliate (min_amount_idr).
-- Dipakai admin (mark-paid ditolak di bawah threshold) & dashboard mitra
-- (progress menuju payout). Default 50.000; bisa diubah admin via settings.

update public.platform_settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{min_amount_idr}',
  '50000'::jsonb,
  true
)
where key = 'affiliate';
