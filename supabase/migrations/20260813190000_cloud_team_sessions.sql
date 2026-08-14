-- Sesi login tim cloud (dashboard login username+PIN tanpa akun Google).
-- Token acak, expiry 24 jam, lazy cleanup saat validasi (expires_at=gt.now).

create table if not exists public.cloud_team_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.cloud_team_members (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists cloud_team_sessions_token_idx on public.cloud_team_sessions (token);
create index if not exists cloud_team_sessions_member_idx on public.cloud_team_sessions (member_id);

