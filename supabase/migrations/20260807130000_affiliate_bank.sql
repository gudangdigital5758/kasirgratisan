-- Profitku Affiliate — detail bank affiliator (payout)
-- Menambah kolom bank (nama bank, no. rekening, atas nama) di tabel affiliates.

alter table public.affiliates
  add column if not exists bank_name text,
  add column if not exists bank_account_no text,
  add column if not exists bank_account_name text;

COMMENT ON COLUMN public.affiliates.bank_name IS 'Nama bank untuk pembayaran komisi';
COMMENT ON COLUMN public.affiliates.bank_account_no IS 'Nomor rekening affiliator';
COMMENT ON COLUMN public.affiliates.bank_account_name IS 'Nama pemilik rekening (atas nama)';
