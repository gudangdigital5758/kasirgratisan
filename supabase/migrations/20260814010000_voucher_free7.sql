-- Profitku Cloud — voucher trial FREE7: gratis 7 hari, sekali per akun.
-- max_per_user=1 => redemptions per user dibatasi 1 (validateVoucherForUser).
-- Plan cloud_monthly supaya hanya berlaku untuk paket cloud.

insert into public.vouchers (
  code, type, value, plan_id, max_redemptions, max_per_user,
  starts_at, ends_at, is_active, note
)
values (
  'FREE7', 'free_days', 7, 'cloud_monthly', null, 1,
  null, null, true, 'Trial 7 hari Profitku Cloud - sekali per akun'
)
on conflict (upper(code)) do nothing;
