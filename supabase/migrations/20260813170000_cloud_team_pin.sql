-- Fase C4 — PIN login cloud untuk anggota tim (keputusan: PIN via dashboard).
-- hash = SHA-256(pin + ':' + member_id) — deterministik lintas device (tanpa
-- deviceId salt, karena verifikasi di server). Hanya worker yang memakai.

alter table public.cloud_team_members
  add column if not exists pin_hash text;
