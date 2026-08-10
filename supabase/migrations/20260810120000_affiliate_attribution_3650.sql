-- Profitku Affiliate — jendela atribusi 3650 hari (10 tahun)
--
-- Keputusan 2026-08-10 (docs/DECISIONS.md): jalur referral localStorage
-- berlaku 3650 hari sejak klik link — praktis permanen. User yang berlangganan
-- cloud jauh setelah klik (bulan/tahun kemudian, di perangkat yang sama)
-- tetap memberikan komisi ke affiliator pengundang.
-- Nilai dibaca Worker per-request dari platform_settings → aktif tanpa redeploy.
-- Admin tetap bisa mengatur 1–3650 via Profitku Admin.

update public.platform_settings
set value = value || '{"attribution_days": 3650}'::jsonb
where key = 'affiliate';
