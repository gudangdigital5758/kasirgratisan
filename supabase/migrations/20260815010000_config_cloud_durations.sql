-- Profitku Cloud — konfigurasi terpusat: durasi langganan (display).
-- Harga final tetap dihitung worker (seed-plans cloudDurationFactor);
-- config ini dipakai UI (label + faktor display) dengan fallback konstanta.

do $$
begin
  if not exists (select 1 from public.app_settings where key = 'cloud_durations') then
    insert into public.app_settings (key, value, description, updated_at)
    values (
      'cloud_durations',
      '{"items":[{"months":1,"priceFactor":1,"label":"1 bulan"},{"months":6,"priceFactor":5,"label":"6 bulan (bayar 5)"},{"months":12,"priceFactor":10,"label":"12 bulan (bayar 10)"}]}'::jsonb,
      'Durasi langganan cloud: months + priceFactor (display). Harga final server-side.',
      now()
    );
  end if;
end $$;
