-- Drop selfcheck sementara (20260813130000) setelah diverifikasi via REST:
-- {"ok": true} — fn_report_summary + fn_report_detail jalan tanpa 42883.
drop function if exists public.fn_report_selfcheck();
