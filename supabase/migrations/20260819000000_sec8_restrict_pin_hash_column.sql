-- SEC-008 (2026-08-19): batasi akses kolom pin_hash di cloud_team_members.
-- Verifikasi PIN hanya dilakukan Worker (service_role). Client (anon/authenticated)
-- tidak perlu membaca/menulis pin_hash — revoke menghilangkan eksposur hash PIN
-- (offline brute-force) bila baris dibaca; worker tetap berfungsi (service_role).
-- NOTE: RLS SELECT sudah membatasi member ke baris sendiri; hardening kolom ini
-- menghapus pin_hash dari response client secara defensif depth-in-depth.

revoke insert, update, select on public.cloud_team_members(pin_hash) from anon, authenticated;
