-- SEC-005 (2026-08-19) fase B: hapus plaintext token sesi (sudah di-backfill ke
-- token_hash di migration A; kode sudah lookup via token_hash).
-- Dijalankan SETELAH kode worker live (jika tidak, sesi/login tim akan error
-- karena kolom token tidak ada).
drop index if exists cloud_team_sessions_token_idx;
alter table public.cloud_team_sessions
  drop column if exists token;
