-- F2 — Role & Hak Akses Menu per Toko (RBAC dashboard cloud.profitku.my.id), 2026-08-16
-- Built-in: admin, kasir, salesman, kepala_gudang, karyawan (seed per toko).
-- Custom role: owner/admin tambah lewat UI Tim & Peran (key unik per toko).
-- menus = daftar menu dashboard yang BOLEH diakses role tsb (checked = terlihat).
-- Owner (stores.user_id) implicit semua menu — tidak butuh baris di sini.

create table if not exists public.cloud_team_roles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  key text not null,
  name text not null,
  menus text[] not null default '{}',
  is_built_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, key)
);

create index if not exists cloud_team_roles_store_idx on public.cloud_team_roles (store_id);

-- Role anggota tim tidak lagi terbatas enum 5 — custom role diizinkan.
alter table public.cloud_team_members
  drop constraint if exists cloud_team_members_role_check;

-- Seed built-in untuk semua toko existing (idempotent). Store baru di-seed worker (ensureRoleSeed).
insert into public.cloud_team_roles (store_id, key, name, menus, is_built_in)
select s.id, r.key, r.name, r.menus::text[], true
from public.stores s
cross join (
  values
    ('admin', 'Admin', '{overview,billing,backups,reports,team,pricing,online_store,sales,ai,pos_app}'::text[]),
    ('kasir', 'Kasir', '{cashier,pos_app}'::text[]),
    ('salesman', 'Salesman', '{sales,pos_app}'::text[]),
    ('kepala_gudang', 'Kepala Gudang', '{reports,pricing,pos_app}'::text[]),
    ('karyawan', 'Karyawan', '{pos_app}'::text[])
) as r(key, name, menus)
on conflict (store_id, key) do nothing;

-- RLS: baca owner/member; tulis owner (defense-in-depth — worker service-role menegakkan juga).
alter table public.cloud_team_roles enable row level security;

create policy cloud_team_roles_select on public.cloud_team_roles for select
  using (
    store_id in (select id from public.stores where user_id = auth.uid())
    or store_id in (select store_id from public.cloud_team_members where user_id = auth.uid())
  );

create policy cloud_team_roles_insert on public.cloud_team_roles for insert
  with check (store_id in (select id from public.stores where user_id = auth.uid()));

create policy cloud_team_roles_update on public.cloud_team_roles for update
  using (store_id in (select id from public.stores where user_id = auth.uid()));

create policy cloud_team_roles_delete on public.cloud_team_roles for delete
  using (store_id in (select id from public.stores where user_id = auth.uid()));
