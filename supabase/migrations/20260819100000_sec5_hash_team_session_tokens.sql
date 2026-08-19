-- SEC-005 (2026-08-19) fase A: hash token sesi tim + revoke akses client.
-- - token_hash = sha256(token) hex; backfill dari token existing (tidak bisa
--   reverse), unique index.
-- - revoke DML anon/authenticated (defense-in-depth; RLS sudah aktif deny-all).
-- - Kolom token plaintext DIHAPUS di migration B setelah kode live (lookup hash).
create extension if not exists pgcrypto with schema extensions;

alter table public.cloud_team_sessions
  add column if not exists token_hash text;

update public.cloud_team_sessions
   set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 where token_hash is null
   and token is not null;

alter table public.cloud_team_sessions
  alter column token_hash set not null;

create unique index if not exists cloud_team_sessions_token_hash_uidx
  on public.cloud_team_sessions (token_hash);

revoke all on public.cloud_team_sessions from anon, authenticated;
