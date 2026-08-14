-- Fase C4 simplify: login tim pakai USERNAME + PIN (di-set owner/admin),
-- bukan email. Email tetap dipakai untuk undangan (invite_email).
-- username: 3-20 huruf/angka/underscore/titik, unik per toko.

alter table public.cloud_team_members
  add column if not exists username text;

create unique index if not exists cloud_team_members_store_username_uidx
  on public.cloud_team_members (store_id, lower(username))
  where username is not null;

