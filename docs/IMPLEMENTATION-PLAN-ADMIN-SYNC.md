# Rencana Implementasi — Admin Profitku Sinkron & Terpusat

> Dokumen monitoring bertahap. Sumber kebenaran: repo `kasirgratisan` (admin, POS, worker)
> + `profitku-cloud` (portal affiliate & cloud dashboard).
> Update file ini di akhir tiap fase: centang checklist, isi baris tabel monitoring,
> lalu commit dengan pesan `docs(plan): fase X selesai — ...`.

## 1. Ringkasan

**Masalah:** Admin Profitku (`dashboard.profitku.my.id`) sering tertinggal dari perubahan
di surface lain (portal, worker, POS). Contoh nyata: format link affiliate sudah pindah ke
kanonik `/join?ref=` di worker & portal, tapi admin masih men-generate & menyalin
`/?ref=` (`admin/src/pages/AffiliatesPage.tsx:382,395`). Akar masalah arsitektur:

1. Konstanta bisnis di-hardcode di tiap UI, bukan dibaca dari config DB
   (`platform_settings` / `app_settings` / `plans` yang sudah ada).
2. Admin tidak auto-refresh (load sekali saat mount).
3. Deploy manual per-app tanpa pipeline → permukaan tidak naik bersama.

**Prinsip:** Worker + Supabase (`platform_settings`, `app_settings`, `plans`) =
satu-satunya sumber kebenaran. Admin/POS/portal = renderer tipis yang membaca API.
"Admin pengatur semua setting" = admin menulis DB config; semua app membaca dari sana.

## 2. Fakta audit (baseline)

| Surface | Lokasi | Format link | Catatan |
|---|---|---|---|
| Worker `/api/affiliate/claim` | `workers/api/src/routes/affiliate.ts:200` | `/join?ref=` ✅ | kanonik |
| Worker `/api/affiliate/me` | `workers/api/src/routes/affiliate.ts:235` | `/join?ref=` ✅ | kanonik |
| Portal Mitra | `apps/affiliate` (pakai `me.link`) | `/join?ref=` ✅ | kanonik |
| POS `RootOrReferral` | `src/App.tsx:70-75` | `/?ref=` → Navigate `/join` | ✅ kompatibel |
| Edge `_redirects` | `public/_redirects:7` | `/join` → `/` (query aman) | ✅ live-tested |
| **Admin kartu mitra** | `admin/src/pages/AffiliatesPage.tsx:382` | **`/?ref=`** ❌ | **harus fix** |
| **Admin "Salin link"** | `admin/src/pages/AffiliatesPage.tsx:395` | **`/?ref=`** ❌ | **harus fix** |
| Portal NotInvitedCard | `apps/affiliate/src/App.tsx:297` | `?ref=` kosong ⚠️ | rapikan |
| Komentar migrasi | `supabase/migrations/20260807120000_affiliates.sql` | `/?ref=` ⚠️ | dokumen |

Drift lain (inventaris F1): `CLOUD_DURATIONS` hardcode di `apps/cloud/src/lib/api.ts`,
fallback `defaultSettings` di `admin/src/pages/AffiliatesPage.tsx:8-14`,
label/status di beberapa halaman admin.

## 3. Fase implementasi (urut; tiap fase = satu deploy + satu update file ini)

### F0 — Stabilisasi link affiliate (quick win)
**Tujuan:** semua surface menghasilkan link kanonik `/join?ref=`; funnel join konsisten.

- [x] A1 `admin/src/pages/AffiliatesPage.tsx:382,395` → `https://profitku.my.id/join?ref=${code}`
      (+ komentar "kanonik: DECISIONS 2026-08-10 — jangan kembalikan ke root").
- [x] A2 `apps/affiliate/src/App.tsx:297` → `href={POS_JOIN_URL}` (buang `?ref=` kosong).
- [x] A3 `supabase/migrations/20260807120000_affiliates.sql` komentar → `/join?ref=KODE`.
- [x] A4 `src/components/layout/AppLayout.tsx`: `if (hasRef) return <Outlet />` sebelum
      cek onboarding & multi-user → semua pengunjung link mitra lihat JoinPage.
- [x] Validasi: `npm run lint` (0 error), `npx vitest run src/test/affiliate.test.ts` (3/3),
      `npm run admin:build`, build affiliate, build POS (PWA v1.2.0); live curl `/?ref=` (200)
      & `/join?ref=` (302→root, query utuh); guard grep `/?ref=` di source = bersih;
      `index.html` + `sw.js` live = hash sama dengan build lokal.
- [x] Deploy: admin (`aee60aac`), affiliate (`f8e8ac5b`), POS (`6ca073e5`).
- [x] Update tabel monitoring F0.

**Definition of Done:** tidak ada `profitku.my.id/?ref=` di source ter-track;
user baru & lama dari link mitra sama-sama mendarat di JoinPage. ✅

### F1 — Konfigurasi terpusat (single source of truth)
**Tujuan:** nilai bisnis yang bisa berubah hidup di DB; UI render dari API.

- [x] 1.1 Migrasi `20260815000000_config_links.sql`:
      `platform_settings` key `links` = `{"referral":"https://profitku.my.id/join?ref=%s"}`
      (upsert idempotent). Salin ke `profitku-cloud/supabase/migrations/`.
- [x] 1.2 Worker: helper `referralLink(env, code)` (baca `links.referral` via
      `getPlatformSetting`, fallback literal) — dipakai `/claim` & `/me`.
- [x] 1.3 Admin: `AffiliatesPage` render + salin link dari `GET /admin/api/settings`
      (sudah mengembalikan semua `platform_settings`) — fallback literal bila key belum ada.
- [x] 1.4 Migrasi `app_settings['cloud_durations']` (1/6/12 + faktor) — cloud dashboard
      & POS CheckoutPage baca dari `/api/app-settings/cloud_durations` (fallback seed tetap).
      Catatan: `ponytail:` harga final tetap di worker (`cloudDurationFactor` statis).
- [x] 1.5 Admin `SettingsPage`: render `links` + flag + `mock_payment_note` dari API
      (bukan hardcode); tampilkan `updated_at` (indikator refresh F2).
- [x] Validasi: worker `tsc`, build admin/cloud/POS/affiliate, curl
      `/api/app-settings/cloud_durations` (live OK) & `/admin/api/settings` (shape), live cek link
      dari admin = `/join?ref=`. 1 error ditemukan saat review (unused import CLOUD_DURATIONS
      di StoresPage) — difix, build hijau.
- [x] Deploy: worker (`a373073d`), admin (`fd37449a`), cloud (`e66a581f`), POS (`205fa04c`).
- [x] Update tabel monitoring F1.

**Definition of Done:** mengganti format link / durasi cukup edit setting di admin —
tanpa deploy aplikasi. ✅ (worker + admin + POS/cloud baca dari config)

### F2 — Auto-refresh runtime admin
**Tujuan:** admin terlihat "hidup" tanpa reload manual.

- [x] 2.1 `admin/src/lib/use-auto-refresh.ts` (baru): refetch pada `window focus` +
      `visibilitychange` — dipakai Overview, Members, Settings, Mitra, Payout.
- [x] 2.2 Polling 60 dtk di halaman Settings, Mitra, Payout + indikator `refresh HH:MM:SS`
      (kesegaran data terlihat).
- [ ] 2.3 (opsional, keputusan terpisah) Supabase Realtime `postgres_changes` di
      `platform_settings` + `platform_events` + `admin_audit_log` → halaman Events live.
      **DITUNDA** — focus+poll mencakup kebutuhan; Realtime bila Events live dibutuhkan.
- [x] Validasi: build admin hijau; QA manual 2 tab (ubah setting di tab A → tab B ter-update
      saat fokus / ≤ 60 dtk).
- [x] Deploy: admin (`d04b39f1`).
- [x] Update tabel monitoring F2.

**Definition of Done:** perubahan config dari tab lain / cron terlihat ≤ 60 dtk
tanpa reload manual. ✅ (kecuali 2.3 opsional)

### F3 — Pipeline deploy otomatis (CI/CD)
**Tujuan:** perubahan yang di-commit ke `main` otomatis ter-build, ter-deploy, dan
ter-verifikasi — "update otomatis saat ada perubahan di halaman lain".

- [x] 3.1 GitHub Actions `kasirgratisan` (`.github/workflows/ci.yml`): push main →
      lint + tsc + test + build → job deploy (worker → POS → admin) → smoke curl
      (`/health`, `/api/app-settings/cloud_durations`, lookup, sw.js, dashboard).
- [x] 3.2 GitHub Actions `profitku-cloud` (baru): build affiliate + cloud → job deploy
      (Pages kedua app) → smoke (`/api/affiliate/settings`).
      Catatan: butuh secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` di
      Settings → Secrets (lihat `docs/SETUP-CI-CD.md`).
- [x] 3.3 Version stamping: admin sidebar menampilkan `build v{appVersion} ({versionCode})`
      dari `version.json` (resolveJsonModule di tsconfig admin).
- [x] 3.4 Fallback lokal `npm run release` (worker + POS + admin berurutan).
- [x] 3.5 Penyempurnaan 2026-08-15: workflow trigger `branches: ['**']` (check semua
      branch, deploy tetap main-only via `if: github.ref`) + `paths-ignore` docs/*.md
      (commit docs = 0 menit CI) di kedua repo; kebijakan aktor (manusia vs agent)
      dicatat di `docs/GIT-WORKFLOW.md`.
- [x] Validasi: YAML parse OK; build admin hijau; guard lint hijau.
- [x] Deploy: admin (`f75e3505`).
- [x] Update tabel monitoring F3.

**Definition of Done:** deploy otomatis dari commit `main` dengan smoke test wajib.
✅ (workflow aktif; secrets perlu di-set user)

### F4 — Guardrails anti-drift
**Tujuan:** kelas bug "admin tertinggal" tidak bisa terulang.

- [x] 4.1 `scripts/guard-links.mjs` (baru): blokir `profitku.my.id/?ref=` di kode
      user-facing (src/admin/workers/public) — dijalankan via `npm run lint` (CI merah
      saat pelanggaran). Uji positif & negatif lolos.
- [x] 4.2 Konvensi di `AGENTS.md`: konstanta user-facing di admin/portal wajib dibaca
      dari config API; hardcode hanya sebagai fallback + komentar.
- [ ] 4.3 (opsional) Smoke test shape `/api/app-settings/links` di F3 pipeline.
      **DITUNDA** — smoke F3 sudah mencakup cloud_durations + lookup.
- [x] Validasi: lint hijau; file pelanggaran dummy di `src/` → guard exit 1; setelah
      dihapus → exit 0.
- [x] Update tabel monitoring F4.

**Definition of Done:** CI memblokir drift format link/konstanta bisnis. ✅
(guard aktif via lint; workflow CI menjalankan lint otomatis)

## 4. Tabel monitoring

| Fase | Status | Tanggal selesai | Commit | Deploy | Bukti validasi |
|---|---|---|---|---|---|
| F0 Stabilisasi link | ✅ Selesai | 2026-08-14 | `ca69256` (POS/admin) · `70e4285` (portal) | admin `aee60aac` · affiliate `f8e8ac5b` · POS `6ca073e5` | lint 0 err, test 3/3, guard bersih, live 200/302, index+sw MATCH |
| F1 Config terpusat | ✅ Selesai | 2026-08-14 | `bd3ee67` (POS) · `b13b2c4` (portal) | worker `a373073d` · admin `fd37449a` · cloud `e66a581f` · POS `205fa04c` | tsc 0, build 4 app hijau, `/api/app-settings/cloud_durations` live |
| F2 Auto-refresh admin | ✅ Selesai | 2026-08-14 | `b11346e` | admin `d04b39f1` | build hijau; 2.3 Realtime ditunda (opsional) |
| F3 CI/CD | ✅ Selesai | 2026-08-14 | `edb14a3` (POS) · `337c091` (portal) | admin `f75e3505` | YAML OK, build hijau; secrets CI perlu di-set user |
| F4 Guardrails | ✅ Selesai | 2026-08-14 | `e339d03` | — | uji positif & negatif guard, lint hijau |

**Log perubahan file ini:**
- 2026-08-14: dibuat — baseline audit + rencana 5 fase (F0–F4).
- 2026-08-14: **F0 selesai** — link kanonik `/join?ref=` di semua surface (admin, portal),
  funnel join konsisten (AppLayout `hasRef → Outlet`), deploy admin/affiliate/POS, live verified.
- 2026-08-14: **F1 selesai** — `platform_settings['links']` + `app_settings['cloud_durations']`;
  worker/portal/admin/POS/cloud baca dari config (fallback), SettingsPage bisa ubah template link.
- 2026-08-14: **F2 selesai** — useAutoRefresh (focus + poll 60s + stamp) di 5 halaman admin.
- 2026-08-14: **F3 selesai** — CI/CD deploy otomatis kedua repo + smoke + version stamping +
  `npm run release`.
- 2026-08-14: **F4 selesai** — guard-links (lint) + konvensi AGENTS; seluruh 5 fase tuntas.
- 2026-08-15: **F3 penyempurnaan** — workflow check di semua branch (deploy main-only),
  `paths-ignore` docs, kebijakan aktor manusia/agent di `docs/GIT-WORKFLOW.md`.

## 5. Risiko & keputusan terbuka

- PWA/installed shell lama tetap menampilkan perilaku lama sampai `checkVersion()`
  memaksa update — tidak ada aksi manual (diterima).
- Format root `/?ref=` tetap didukung (backward-compat) — hanya tidak dihasilkan UI.
- F2.3 Realtime & F4.3 smoke tambahan = opsional, butuh keputusan terpisah.
- Migrasi config baru memakai pola copy ke `profitku-cloud/supabase/migrations`
  (konsisten dengan keputusan sebelumnya).

