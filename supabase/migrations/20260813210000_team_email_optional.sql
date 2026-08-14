-- Email opsional untuk anggota tim (identitas = username). Tambah kolom nama opsional.

alter table public.cloud_team_members
  drop constraint if exists cloud_team_members_check,
  add column if not exists name text;