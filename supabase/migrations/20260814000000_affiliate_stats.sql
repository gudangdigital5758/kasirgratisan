-- Profitku Affiliate — statistik link undangan (klik & signup per affiliator).
-- Dipakai dashboard affiliate.profitku.my.id (halaman Ringkasan & Link).
-- Klik: dihitung dari GET /api/affiliate/lookup (link ?ref=KODE dibuka).
-- Signup: dihitung saat claim sukses user baru (registerAffiliate created=true).
-- Counter best-effort (race kecil tidak masalah untuk statistik tampilan).

alter table public.affiliates
  add column if not exists click_count integer not null default 0,
  add column if not exists signup_count integer not null default 0;
