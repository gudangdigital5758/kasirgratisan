-- Profitku Cloud — pembatasan trial: first_time_only.
-- FREE7 hanya untuk akun yang BELUM PERNAH punya langganan cloud
-- (baris subscriptions untuk user itu tidak ada, status apa pun).
-- Ditegakkan di validateVoucherForUser (cek subscriptions user).

alter table public.vouchers
  add column if not exists first_time_only boolean not null default false;

update public.vouchers
set first_time_only = true
where upper(code) = 'FREE7';
