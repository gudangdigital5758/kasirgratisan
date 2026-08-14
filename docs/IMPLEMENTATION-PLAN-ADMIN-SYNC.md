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

- [ ] A1 `admin/src/pages/AffiliatesPage.tsx:382,395` → `https://profitku.my.id/join?ref=${code}`
      (+ komentar "kanonik: DECISIONS 2026-08-10 — jangan kembalikan ke root").
- [ ] A2 `apps/affiliate/src/App.tsx:297` → `href={POS_JOIN_URL}` (buang `?ref=` kosong).
- [ ] A3 `supabase/migrations/20260807120000_affiliates.sql` komentar → `/join?ref=KODE`.
- [ ] A4 `src/components/layout/AppLayout.tsx`: `if (hasRef) return <Outlet />` sebelum
      cek onboarding & multi-user → semua pengunjung link mitra lihat JoinPage.
- [ ] Validasi: `npm run lint`, `npx vitest run src/test/affiliate.test.ts`,
      `npm run admin:build`, build affiliate; live curl `/?ref=` (200) & `/join?ref=` (302→root, query utuh).
- [ ] Deploy: admin, affiliate, POS.
- [ ] Update tabel monitoring F0.

**Definition of Done:** tidak ada `profitku.my.id/?ref=` di source ter-track;
user baru & lama dari link mitra sama-sama mendarat di JoinPage.

### F1 — Konfigurasi terpusat (single source of truth)
**Tujuan:** nilai bisnis yang bisa berubah hidup di DB; UI render dari API.

- [ ] 1.1 Migrasi `20260815000000_config_links.sql`:
      `platform_settings` key `links` = `{"referral":"https://profitku.my.id/join?ref=%s"}`
      (upsert idempotent). Salin ke `profitku-cloud/supabase/migrations/`.
- [ ] 1.2 Worker: helper `referralLink(env, code)` (baca `links.referral` via
      `getPlatformSetting`, fallback literal) — dipakai `/claim` & `/me`.
- [ ] 1.3 Admin: `AffiliatesPage` render + salin link dari `GET /admin/api/settings`
      (sudah mengembalikan semua `platform_settings`) — fallback literal bila key belum ada.
- [ ] 1.4 Migrasi `app_settings['cloud_durations']` (1/6/12 + faktor) — cloud dashboard
      & POS CheckoutPage baca dari `/api/app-settings/cloud_durations` (fallback seed tetap).
- [ ] 1.5 Admin `SettingsPage`: render `links` + flag + `mock_payment_note` dari API
      (bukan hardcode); tampilkan `updated_at`.
- [ ] Validasi: worker `tsc`, build admin/cloud/POS/affiliate, curl
      `/api/app-settings/cloud_durations` & `/admin/api/settings` (shape), live cek link
      dari admin = `/join?ref=`.
- [ ] Deploy: worker, admin, cloud, POS.
- [ ] Update tabel monitoring F1.

**Definition of Done:** mengganti format link / durasi cukup edit setting di admin —
tanpa deploy aplikasi.

### F2 — Auto-refresh runtime admin
**Tujuan:** admin terlihat "hidup" tanpa reload manual.

- [ ] 2.1 `admin/src/pages/Shell.tsx`: refetch data aktif pada `window focus` +
      `visibilitychange` (pola `apps/affiliate` Landing).
- [ ] 2.2 Polling 60 dtk di halaman Settings, Mitra, Payout (refetch + tampilkan
      `updated_at` sebagai indikator kesegaran).
- [ ] 2.3 (opsional, keputusan terpisah) Supabase Realtime `postgres_changes` di
      `platform_settings` + `platform_events` + `admin_audit_log` → halaman Events live.
- [ ] Validasi: QA manual 2 tab (ubah setting di tab A → tab B ter-update ≤ 60 dtk),
      build admin.
- [ ] Deploy: admin.
- [ ] Update tabel monitoring F2.

**Definition of Done:** perubahan config dari tab lain / cron terlihat ≤ 60 dtk
tanpa reload manual.

### F3 — Pipeline deploy otomatis (CI/CD)
**Tujuan:** perubahan yang di-commit ke `main` otomatis ter-build, ter-deploy, dan
ter-verifikasi — "update otomatis saat ada perubahan di halaman lain".

- [ ] 3.1 GitHub Actions `kasirgratisan`: push main → lint + tsc + test + build →
      deploy worker → POS → admin → smoke curl (`/health`, `/api/plans`,
      `/api/app-settings/links`).
- [ ] 3.2 GitHub Actions `profitku-cloud`: build → deploy affiliate + cloud → smoke
      (`/api/affiliate/settings`).
- [ ] 3.3 Version stamping: header admin menampilkan `version.json` + Worker Version ID
      (dari `/health` atau env deploy) — mismatch build langsung terlihat.
- [ ] 3.4 Fallback lokal `npm run release` (build+deploy semua app berurutan) untuk
      sebelum CI aktif.
- [ ] Validasi: push percobaan → pipeline green + smoke pass.
- [ ] Update tabel monitoring F3.

**Definition of Done:** deploy otomatis dari commit `main` dengan smoke test wajib.

### F4 — Guardrails anti-drift
**Tujuan:** kelas bug "admin tertinggal" tidak bisa terulang.

- [ ] 4.1 Grep-guard CI: build gagal bila source mengandung `profitku.my.id/?ref=`
      (atau pola URL bisnis hardcode di luar allowlist) — script `scripts/guard-links.mjs`.
- [ ] 4.2 Konvensi di `AGENTS.md`: konstanta user-facing di admin/portal wajib dibaca
      dari config API; hardcode hanya sebagai fallback + komentar.
- [ ] 4.3 (opsional) Smoke test shape `/api/app-settings/links` di F3 pipeline.
- [ ] Validasi: commit pelanggaran dummy → CI merah; revert → hijau.
- [ ] Update tabel monitoring F4.

**Definition of Done:** CI memblokir drift format link/konstanta bisnis.

## 4. Tabel monitoring

| Fase | Status | Tanggal selesai | Commit | Deploy | Bukti validasi |
|---|---|---|---|---|---|
| F0 Stabilisasi link | [ ] | — | — | — | — |
| F1 Config terpusat | [ ] | — | — | — | — |
| F2 Auto-refresh admin | [ ] | — | — | — | — |
| F3 CI/CD | [ ] | — | — | — | — |
| F4 Guardrails | [ ] | — | — | — | — |

**Log perubahan file ini:**
- 2026-08-14: dibuat — baseline audit + rencana 5 fase (F0–F4).

## 5. Risiko & keputusan terbuka

- PWA/installed shell lama tetap menampilkan perilaku lama sampai `checkVersion()`
  memaksa update — tidak ada aksi manual (diterima).
- Format root `/?ref=` tetap didukung (backward-compat) — hanya tidak dihasilkan UI.
- F2.3 Realtime & F4.3 smoke tambahan = opsional, butuh keputusan terpisah.
- Migrasi config baru memakai pola copy ke `profitku-cloud/supabase/migrations`
  (konsisten dengan keputusan sebelumnya).

