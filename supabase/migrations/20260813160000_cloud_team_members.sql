-- Fase C — Tim & Roles Cloud (dashboard cloud.profitku.my.id), 2026-08-13
-- Anggota tim per toko. Owner = stores.user_id (implied, bukan baris di sini).
-- Role: owner (implied) | admin | kasir | salesman | kepala_gudang | karyawan.
-- Undangan: kalau email sudah punya profile → active langsung; belum → pending.

create table if not exists public.cloud_team_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'kasir', 'salesman', 'kepala_gudang', 'karyawan')),
  invite_email text,
  invite_state text not null default 'active' check (invite_state in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id),
  check (user_id is not null or (invite_email is not null and length(trim(invite_email)) > 0))
);

create index if not exists cloud_team_members_store_idx on public.cloud_team_members (store_id);
create index if not exists cloud_team_members_user_idx on public.cloud_team_members (user_id);

-- RLS: baca untuk owner/member; tulis hanya owner (worker service-role menegakkan
-- ownership juga — RLS ini defense-in-depth untuk akses langsung via anon key).
alter table public.cloud_team_members enable row level security;

create policy cloud_team_members_select_owner
  on public.cloud_team_members for select
  using (
    store_id in (select id from public.stores where user_id = auth.uid())
    or user_id = auth.uid()
  );

create policy cloud_team_members_insert_owner
  on public.cloud_team_members for insert
  with check (
    store_id in (select id from public.stores where user_id = auth.uid())
  );

create policy cloud_team_members_update_owner
  on public.cloud_team_members for update
  using (
    store_id in (select id from public.stores where user_id = auth.uid())
  );

create policy cloud_team_members_delete_owner
  on public.cloud_team_members for delete
  using (
    store_id in (select id from public.stores where user_id = auth.uid())
  );
