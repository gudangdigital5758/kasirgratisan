-- Sync realtime (B1): Supabase Realtime sebagai pemicu "pull sekarang" antar
-- perangkat. Event hanya sinyal — data tetap lewat pipeline push/pull LWW.
-- Jalankan via: supabase db push | SQL Editor

-- 1. Publikasikan sync_records ke Realtime (WAL). Perubahan baris pada tabel
--    ini (hasil push device lain) diteruskan ke channel client yang subscribe.
alter publication supabase_realtime add table public.sync_records;

-- 2. RLS SELECT untuk pemilik toko. Sebelumnya tabel ini tanpa policy untuk
--    authenticated (hanya service role); Realtime menghormati RLS, jadi tanpa
--    policy ini event tidak pernah diterima client.
create policy sync_records_select_owner on public.sync_records
  for select
  using (
    exists (
      select 1 from public.stores s
      where s.id = sync_records.store_id
        and s.user_id = auth.uid()
    )
  );
