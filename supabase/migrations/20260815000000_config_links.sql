-- Profitku Cloud — konfigurasi terpusat: template link referral.
-- Dipakai worker (claim/me) & admin UI; mengubah format link cukup edit
-- setting ini (tanpa deploy). %s = kode referral.

do $$
begin
  if not exists (select 1 from public.platform_settings where key = 'links') then
    insert into public.platform_settings (key, value, updated_at)
    values ('links', '{"referral":"https://profitku.my.id/join?ref=%s"}'::jsonb, now());
  end if;
end $$;
