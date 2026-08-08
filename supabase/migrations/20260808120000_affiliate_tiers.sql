-- Profitku Affiliate — komisi 5 tier + auto REF + pohon referral
--
-- Keputusan 2026-08-08 (docs/DECISIONS.md):
--  - Komisi bertingkat s.d. 5 level (Opsi A: persen dari nominal pembayaran).
--    Nilai per tier diatur admin lewat platform_settings key 'affiliate' →
--    `tiers: [20, 5, 3, 2, 1]` (tier 1 = referrer langsung).
--  - Siapa pun dapat mendaftar jadi affiliator (tidak wajib berlangganan cloud).
--  - Kode REF dibuat otomatis di server bila tidak diisi manual.
--  - Komisi hanya untuk langganan cloud (payment COMPLETED), termasuk perpanjangan.

-- === affiliates: relasi pohon referral + unik per user ===
alter table public.affiliates
  add column if not exists referred_by uuid references public.affiliates (id) on delete set null;

create index if not exists affiliates_referred_by_idx
  on public.affiliates (referred_by);

-- Satu affiliator per user (mendukung auto-register via login Google;
-- NULL tetap boleh banyak sehingga affiliator admin legacy tidak bentrok).
create unique index if not exists affiliates_user_uidx
  on public.affiliates (user_id);

-- === affiliate_commissions: tier + idempotensi per (payment, tier) ===
alter table public.affiliate_commissions
  add column if not exists tier integer not null default 1 check (tier between 1 and 5);

-- Ganti unique index lama (payment_id saja) → per payment+tier.
-- Satu payment menghasilkan s.d. 5 baris komisi (tier 1..5) untuk para ancestor
-- dalam rantai referral; idempotensi tetap terjaga per (payment, tier).
drop index if exists public.affiliate_commissions_payment_uidx;
create unique index if not exists affiliate_commissions_payment_tier_uidx
  on public.affiliate_commissions (payment_id, tier);

create index if not exists affiliate_commissions_tier_idx
  on public.affiliate_commissions (tier);

-- === Settings: tambah `tiers` ke platform_settings (merge, tidak menimpa) ===
-- Baris lama (komisi tunggal 10%) di-upgrade agar punya tiers tanpa kehilangan field lain.
update public.platform_settings
set value = value || '{"tiers": [20, 5, 3, 2, 1]}'::jsonb
where key = 'affiliate'
  and not value ? 'tiers';

insert into public.platform_settings (key, value) values
  ('affiliate', '{
    "enabled": true,
    "commission_percent": 10,
    "tiers": [20, 5, 3, 2, 1],
    "attribution_days": 90,
    "min_amount_idr": 0
  }'::jsonb)
on conflict (key) do nothing;

COMMENT ON COLUMN public.affiliates.referred_by IS 'Affiliator yang mereferensikan (parent) — rantai tier 1..5';
COMMENT ON COLUMN public.affiliate_commissions.tier IS 'Level komisi dalam rantai referral (1 = referrer langsung)';
