# Phase 0 Repository Audit — Profitku

Status: **AUDIT DILAKSANAKAN (2 PASS) — GATE MENUNGGU APPROVAL**

> Audit berbasis evidence (source code, migrations, tests, CI, config). Tidak ada perubahan production code.
> Phase 0 dinyatakan COMPLETE hanya setelah approval manual di `PHASE-0-GATE.md`.

Tanggal audit: 2026-08-17 (pass 1) · 2026-08-17 (pass 2 / re-audit setelah Phase 1)
Branch: `main` @ `6741316`

---

## 1. Repository inventory (VERIFIED)

| Area | Lokasi | Stack | Evidence |
|---|---|---|---|
| POS PWA | `src/` (222 file tracked) | React 18, Vite 6, Tailwind, Dexie 4, i18next, Workbox | `package.json`, `src/lib/db.ts`, `src/lib/sync.ts` |
| Android | `android/` | Capacitor 8 (parallel dengan PWA; listing Play ditunda) | `android/`, `BRAND.playStoreEnabled=false` |
| Cloud API | `workers/api/` (52 file tracked) | Hono 4, Cloudflare Workers, wrangler | `workers/api/src/index.ts`, `wrangler.toml` |
| Admin SPA | `admin/` | Vite + React + Supabase JS + @react-oauth/google | `admin/src/App.tsx`, `admin/wrangler.toml` |
| Database | `supabase/` | 54 migrasi SQL + seed | `supabase/migrations/`, `supabase/seed.sql` |
| Storage | R2 bucket `profitku-backups` | Binding `BACKUP_BUCKET` | `workers/api/wrangler.toml:22-24` |
| Notifikasi | Resend (email), Fonnte (WA), OneSignal (push) | | `workers/api/src/lib/notify.ts`, `lib/lifecycle.ts` |
| Payment | SumoPod (aktif di config) + Midtrans (dual support) + mock | | `wrangler.toml` `PAYMENT_PROVIDER=sumopod`, `lib/sumopod.ts`, `lib/midtrans.ts` |
| CI/CD | GitHub Actions | lint → typecheck → test → build → deploy (main only) → smoke curl | `.github/workflows/ci.yml` |
| Tests | Vitest (jsdom) | 26 file / 132 test PASS | `vitest.config.ts`, hasil `npm test` 2026-08-17 |

Git state saat audit: `AGENTS.md` modified; documentation pack (`docs/00-*`..`07-*`), `PHASE-0-GATE.md`, `PROJECT_STATUS.md`, `progress/`, `AI_MASTER_IMPLEMENTATION_PLAN.md`, `AI_TASK_PROTOCOL.md`, `CHANGELOG.md`, `README-DOCUMENTATION-PACK.md` **untracked** (belum pernah di-commit).

## 2. Runtime/build/deployment audit (VERIFIED)

- Package manager: npm (root + `workers/api` + `admin`), lockfiles tracked.
- CI: `web` job (lint+typecheck+test+build) dan `api` job (tsc --noEmit) wajib hijau sebelum `deploy` (main only). Smoke: `/health`, `/api/app-settings/cloud_durations`, `/api/affiliate/lookup?code=PROFITKU`, `sw.js`, dashboard.
- Deployment: Worker `profitku-api` (wrangler deploy), Pages `profitku` (POS), Pages `profitku-admin` (dashboard), custom domains via Cloudflare.
- Cron Worker: harian 01:00 UTC — dunning H-3/H-1, cleanup backup R2 >30 hari, cleanup quota reservation, payout affiliate bulanan.
- Hasil pengukuran 2026-08-17: `npm test` 132/132 PASS · `npm run lint` 0 error / 26 warning (react-refresh) · `npx tsc --noEmit` (worker) clean.

## 3. Arsitektur aktual (VERIFIED)

```
POS PWA (src/) — IndexedDB `kasirgratisan-db`, offline-first, multi-user PIN, FIFO COGS
  |  Supabase Auth (Google) — JWT di localStorage
  v
Cloudflare Worker (Hono) — service role HANYA di Worker
  |- /api/*        — bearerAuth (JWT via /auth/v1/user, fail-closed) + rate limit + maintenance mode
  |- /admin/api/*  — requireAdmin (admin_users | ADMIN_EMAILS) + RBAC superadmin/support/finance/readonly
  |- /webhook/*    — Midtrans (SHA512) . SumoPod (Svix HMAC | token) . issue-report . client-error . user-type
  `- /api/cron/*   — guard WEBHOOK_SECRET / mock-only
  v
Supabase (service role) — plans, subscriptions (per toko), payments, stores, sync_records,
  vouchers, affiliates/commissions/payouts, cloud_team_*, admin_*, platform_events, credit_* (dorman)
R2 — backup JSON per user/store + quota reservation
```

## 4. Database/schema audit (VERIFIED)

- 54 migrasi, semua additive. Inti: `init_profitku` (profiles/plans/subscriptions/payments/stores + RLS own-row + `user_entitlements`), `admin_ops` (admin_users/admin_audit_log/platform_events/platform_settings — service-role only), `per_store_subscription` (store_id + `store_entitlements` + `create_store_with_limit`), `cloud_billing_atomic` (`fulfill_cloud_payment`), `batch_checkout` (`fulfill_cloud_payment_batch`), `sync` (+keyset/realtime/winner-ack), `online_checkout`/`finance_online`/`shift_pnl`/`store_qris`, affiliates + tiers + payouts, vouchers, `credit_ledger`/`topup_pending`/`ai_jobs` (**dorman — tidak ada code path**), `cloud_scope_hardening` (revoke anon/authenticated dari RPC & views).
- RLS: semua tabel `enable row level security`; client hanya policy own-row / public-read plans / `sync_records_select_owner` (realtime); tabel admin/voucher/affiliate/sync/credit tanpa policy client (service-role only). `stores_public_read` membaca seluruh kolom (lihat SEC-004).
- Seed: single plan `cloud_monthly` Rp 25.000/bulan per toko, 1024 MB storage, `is_active=true`.

## 5. Authentication/RBAC audit (VERIFIED)

- Client: `supabase.auth.signInWithIdToken` (Google), fallback `POST /api/auth/google` (server-side exchange).
- Worker: JWT divalidasi server-side via `/auth/v1/user` — fail-closed (tanpa validasi → userId null).
- Tim cloud: username + PIN (4–6 digit) → token sesi 24 jam (`cloud_team_sessions`); POS verify tanpa sesi, rate-limited 10/menit/IP. **PIN: SHA-256(pin:member_id), tanpa KDF — SEC-001.**
- RBAC store: owner implied; `cloud_team_members` + `cloud_team_roles` (menu-based, `requireMenu`); guard `requireActiveSubscription` (402) di semua mutasi cloud berbayar.
- Admin: `admin_users` (role superadmin/support/finance/readonly) + fallback `ADMIN_EMAILS` env → superadmin; `writeAudit` di mutasi; `canWrite`/`canMutateBilling` server-side.

## 6. Billing/wallet/subscription audit (VERIFIED, lihat juga SECURITY-AUDIT.md)

- Harga & voucher dihitung **server-side**; durasi 1/6/12 bulan (faktor 1/5/10 dari `app_settings.cloud_durations`, fallback seed).
- Fulfillment atomik: `fulfill_cloud_payment(_batch)` — `select for update` + idempotent (`COMPLETED`+`subscription_id` → `alreadyDone`) + unique partial index sub aktif per toko.
- Webhook: verifikasi signature + **amount mismatch ditolak** (Midtrans & SumoPod) + rate limit 60/menit.
- Voucher: percent/free_days/lifetime, `first_time_only`, max per user, redemption dicatat idempotent.
- Affiliate: 5 tier (20/5/3/2/1%), atribusi 3650 hari, komisi idempotent per (payment, tier); payout bulanan idempotent + PPh 23 (2%/4%) — **run tidak atomik antar insert/patch — BILL-004**.
- Wallet credit (`credit_accounts`/`credit_transactions`/`fn_credit_topup/charge/adjust`): schema + RPC ada, grant service_role only — **TIDAK ADA code path Worker yang memanggilnya (dorman)**.
- `POST /payments/google-play/verify` → 410 (Play ditunda, sesuai `BRAND.playStoreEnabled=false`).

## 7. Admin audit (VERIFIED)

- SPA `dashboard.profitku.my.id`: Overview (MRR approximate, members, payments), Members+detail, Payments, Vouchers, Affiliates, Commissions, Payouts, Admin Users (superadmin only), Events (polling `platform_events`), Settings (platform/app settings + health).
- Tidak ada live logs/traffic real-time, tidak ada AI/MSC monitoring (fitur belum ada), tidak ada health per-provider di UI.

## 8. AI Marketing / 9Router / MSC audit

| Domain | State | Evidence |
|---|---|---|
| AI Marketing (metering, Rp100/1M, request_id, wallet charge) | **NOT FOUND di code** — DOCUMENTATION ONLY | 0 referensi `AI_MARKETING`/metering/9Router di `workers/api/src` & `src/`; hanya docs/PRD/ADR |
| 9Router | **NOT FOUND di code** — DOCUMENTATION ONLY | ADR-003 + `docs/03-api/9ROUTER-INTEGRATION.md` target |
| MSC integration | **NOT FOUND di repo ini** — DOCUMENTATION ONLY | ADR-002 (repo terpisah, tidak ada di workspace); `ai_jobs.msc_job_id` dorman |
| Redis/queues/Docker/VPS | **NOT FOUND** | Hanya `docs/06-operations/*` target state |
| Browser automation | **NOT FOUND** (sesuai ADR-005) | Tidak ada di repo ini |

## 9. Technical debt (VERIFIED)

| ID | Area | Severity | Deskripsi |
|---|---|---|---|
| DEBT-001 | Rate limit | P2 | In-memory per-isolate (Map); bypass multi-isolate; perlu KV/DO (dictatat sendiri oleh penulis) |
| DEBT-002 | Schema dorman | P2 | `credit_*`/`ai_jobs`/`topup_pending` dari "namespace migrasi terpisah" (komentar migrasi) tanpa code path |
| DEBT-003 | Docs drift | P2 | Provider pembayaran: `wrangler.toml`=sumopod vs docs mayoritas Midtrans/Xendit |
| DEBT-004 | Quota | P3 | `sumBackupBytes` fetch max 500 baris (bukan SUM SQL) |
| DEBT-005 | Versi | P3 | `package.json` version `0.0.0` + `version.json` via script (dual source) |
| DEBT-006 | Duplikasi | P3 | `rpcError`/`rpcMessage` duplikat di 3 route files |
| DEBT-007 | Working tree | P3 | `dist/`, `build3.log`, file gambar WhatsApp (untracked noise) |
| DEBT-008 | Test infra worker | P1 | Tidak ada test runner/tes untuk Worker & SQL functions |

## 10. Rekomendasi Phase 1 (setelah gate dibuka)

1. SEC-001: PIN → PBKDF2 + migrasi hash + timing-safe compare.
2. TST-001/002: test Worker (fulfill idempotency/concurrency, webhook, voucher, RBAC admin, team login) + integrasi migrasi.
3. SEC-003: tutup `/api/dev/*` di non-dev; BILL-006: guard `PAYMENT_PROVIDER=mock` di prod.
4. SEC-004: subset kolom `stores_public_read`.
5. BILL-004: payout per mitra dalam satu RPC transaksional + filter periode komisi.
6. DEBT-002: keputusan nasib credit ledger (aktifkan untuk Phase 5 atau bersihkan).
7. Dokumentasi provider pembayaran aktual di `docs/DECISIONS.md`.

## 11. Pertanyaan keputusan manusia

1. Upgrade PIN cloud team: invalidasi semua hash lama (minta set ulang) vs migrasi saat login?
2. Provider pembayaran aktual produksi: SumoPod atau Midtrans?
3. Credit ledger dorman: pertahankan untuk rencana AI Marketing atau hapus sampai Phase 5?
4. Role `support` diizinkan `canMutateBilling` (extend subscription) — intended?
5. Cloudflare Access di depan dashboard admin: wajib atau opsional?
6. Auto-deploy main tanpa gate untuk perubahan billing: pertahankan?
7. Commit baseline: `AGENTS.md` modified + documentation pack + progress files?

## 12. Status item yang masih PARTIALLY VERIFIED / UNVERIFIED

- Handler `POST /admin/api/members/:id/extend-subscription` (logika atomik & audit belum dibaca penuh).
- RLS `cloud_team_members` (detail policy select untuk non-owner).
- Konfigurasi deployment aktual Supabase/Cloudflare di luar repo (secrets, custom domain, Access).
- Endpoint export/hapus data user (UU PDP) — tidak ditemukan (UNVERIFIED).

## 14. RE-AUDIT PASS 2 (2026-08-17) — delta setelah Phase 1 + temuan baru

### Status CI (diverifikasi via `gh run list` di `gudangdigital5758/profitku`)

| Commit | Web | API | db-integration | Deploy | Catatan |
|---|---|---|---|---|---|
| 033ea53 (Phase 1 PIN+test) | ✅ | ✅ | — | ✅ | Sebelum job integration ada |
| 29d8c9c (SEC-003/004, BILL-004/006) | ✅ | ✅ | — | ✅ | |
| e2df01a (SEC-002 + voucher + integration) | ✅ | ✅ | ❌ | ✅ | Path script: `../../../` vs `../../../../` |
| 49cce5f (wrangler.toml fix) | ✅ | ✅ | ❌ | ✅ | sama (blm fix) |
| c122ffd (fix path) | ✅ | ✅ | ❌ | ✅ | role `anon` tidak ada di postgres vanilla |
| 8d5aa8c (fix roles) | ✅ | ✅ | ❌ | ✅ | `is_lifetime` butuh migrasi vouchers |
| 9a70c8d (fix deps migrasi) | ✅ | ✅ | ❌ | ✅ | `raw_user_meta_data` di trigger init |
| b442384 (fix stub auth.users) | ✅ | ✅ | ❌ | ✅ | profiles dibuat trigger → insert manual duplikat |
| 503c9cf (fix profiles) | ✅ | ✅ | ❌ | ✅ | `$1` dipakai uuid+text → inconsistent types |
| 6741316 (fix pg params) | ✅ | ✅ | ❌ | ✅ | **FUL-001**: `raw` ambigu di RPC |

### FUL-001 (P1) — referensi `raw` ambigu di `fulfill_cloud_payment` (REPOSITORY FIXED, PRODUCTION UNVERIFIED)

- **Component**: Billing fulfillment RPC (`supabase/migrations/20260811110000_cloud_billing_atomic.sql`).
- **Root cause (terkonfirmasi)**: variabel plpgsql `raw jsonb` + kolom `payments.raw`; di `update public.payments ... set raw = raw || jsonb_build_object(...)` (RHS `raw`) PG15 raise `column reference "raw" is ambiguous` saat eksekusi — semua fulfillment error di environment dari migrasi repo.
- **Fix (commit `f0b4e76`)**: migrasi baru `20260817020000_fix_fulfill_cloud_payment_raw.sql` — `create or replace` dengan rename variabel `raw` → `raw_json` (semua referensi internal; LHS UPDATE tetap kolom `raw`, RHS jadi variabel — unambiguous). Behavior identik; grant/revoke/comment dipertahankan; idempotent.
- **Integration test**: harness `fulfill-concurrency.mjs` + migrasi fix → **CI db-integration GREEN** (run `31997936793`, 2026-08-17T05:26:58Z). 5 koneksi paralel: tepat 1 pemenang, 4 alreadyDone, 1 subscription aktif, replay idempotent, owner mismatch ditolak, extend bukan duplikat.
- **Status prod**: **PRODUCTION VERIFICATION BLOCKED** — tidak ada kredensial Supabase (env `SUPABASE_ACCESS_TOKEN` kosong, `~/.supabase/access-token` tidak ada). Definisi fungsi prod tidak bisa dibaca/dibandingkan; remediation prod tidak bisa dijalankan. Jangan dianggap aman.
- **FUL-007 (baru, P1, OPEN)**: `fulfill_cloud_payment_batch` (`20260812150000_batch_checkout.sql` line 189: `raw = raw,` di UPDATE payments) punya pola ambiguity yang sama. Di luar scope FUL-001 — butuh migrasi fix serupa (rename variabel) + approval.
- **Confidence**: HIGH (error deterministik, CI log QUERY eksplisit, GREEN setelah fix).

### Temuan lain pass 2

| ID | Sev | Komponen | State | Evidence | Aksi |
|---|---|---|---|---|---|
| FUL-002 | P3 | Test flaky | RESOLVED (2026-08-17) | Test bucket rate-limit pakai sleep nyata (10ms/15ms) → flaky. Fix: fake timers (`vi.useFakeTimers` + `advanceTimersByTime(10_001)`), window 10s; test juga kini assert blocked sebelum rollover (lebih ketat). 3× run 55/55 | — |
| FUL-003 | P3 | Infra test | VERIFIED | `gh` CLI di mesin ter-auth ke repo lain (`jipraks/kasirgratisan`) — perlu `-R gudangdigital5758/profitku` | Konfigurasi default repo gh |
| FUL-004 | P3 | Deploy tooling | VERIFIED | Deploy `npm run release` tidak menjalankan migrasi supabase; 2 migrasi baru sempat menunggu push manual | Dokumentasi sudah ada di §13; pertimbangkan script `release` + `supabase db push` berurutan |
| FUL-005 | P2 | Secret hygiene | VERIFIED | PAT `sbp_...` sempat dipakai di sesi (chat + command history) | Sudah dirotasi user; catat: jangan tempel token di chat |
| FUL-006 | P2 | Monitoring | UNVERIFIED | Tidak ada alerting otomatis untuk kegagalan fulfillment/webhook (platform_events hanya dicatat) | Dashboard admin events + notifikasi internal bila payment COMPLETED tanpa subscription |
| FUL-007 | P1 | fulfill_cloud_payment_batch | REPOSITORY FIXED / PRODUCTION UNVERIFIED (2026-08-17) | `20260812150000_batch_checkout.sql` line 189 `raw = raw,` di UPDATE payments — ambiguity identik FUL-001. Fix: migrasi `20260817030000_fix_batch_fulfillment_raw.sql` (rename `raw`→`raw_json`). CI GREEN (run 31998685184) dengan test batch E-H: normal+replay idempotent, 5 concurrent, owner mismatch, item alien dilewati | Push migrasi ke prod menyusul (BLOCKED — tanpa kredensial) |

### Ambiguity sweep billing (2026-08-17, FUL-007 task) — hasil klasifikasi

Semua 32 definisi function di migrasi diperiksa untuk kolisi variabel/parameter vs kolom (payments, subscriptions, stores, plans, sync_records, credit_*, backups, affiliate_*, vouchers, topup_pending).

| Function | File | Finding | Severity | Action | Status |
|---|---|---|---|---|---|
| fulfill_cloud_payment | 20260811110000_cloud_billing_atomic.sql | CONFIRMED BUG: var `raw` vs kolom payments.raw di `SET raw = raw \|\| ...` | P1 (FUL-001) | Fix migrasi 20260817020000 (rename `raw_json`) | FIXED / PROD UNVERIFIED |
| fulfill_cloud_payment_batch | 20260812150000_batch_checkout.sql | CONFIRMED BUG: var `raw` vs kolom payments.raw di `SET raw = raw, ...` (line 189) | P1 (FUL-007) | Fix migrasi 20260817030000 (rename `raw_json`) | FIXED / PROD UNVERIFIED |
| sync_upsert_batch | 20260811180000_sync_winner_ack.sql | SAFE — kolom data/deleted/client_updated_at unqualified tanpa variabel senama; excluded./sync_records. qualified | — | — | SAFE |
| sync_register_device | 20260805120000_sync.sql | SAFE — tanpa variabel lokal | — | — | SAFE |
| reserve_backup_quota | 20260811170000 | SAFE — v_* / existing_status tanpa kolom senama | — | — | SAFE |
| claim_legacy_subscription | 20260811140000 | SAFE — rowtype + plan_limit_mb dll tanpa kolisi | — | — | SAFE |
| fn_credit_topup/charge/adjust | 20260806000000 + 20260806140000 | SAFE — v_* prefix, tidak ada kolom senama | — | — | SAFE |
| fn_online_checkout | 20260816120000 | SAFE — v_*; `data` unqualified = kolom (tanpa variabel) | — | — | SAFE |
| fn_online_debt_payment | 20260816180000 | SAFE — v_debt rowtype + qualified | — | — | SAFE |
| fn_online_stock_move | 20260816180000 | SAFE — v_*; `data` di SET = kolom | — | — | SAFE |
| fn_online_close_shift / fn_online_pnl | 20260816200000 | SAFE — v_* | — | — | SAFE |
| fn_report_summary/detail/selfcheck | 20260813130000 + 13150000 | SAFE — v_*; `data`/`deleted` = kolom tanpa shadowing | — | — | SAFE |
| reset_test_data | 20260810150000 | SAFE — keep_id/n/r tanpa kolom senama | — | — | SAFE |
| handle_new_user / set_updated_at / update_app_settings_updated_at | init + app_settings | SAFE — trigger NEW.* qualified | — | — | SAFE |
| create_store_with_limit | 20260808150000 | SAFE — p_* + rowtype | — | — | SAFE |
| fn_affiliate_payout_create | 20260817010000 | SAFE — v_payout/v_bound | — | — | SAFE |

**Kesimpulan sweep**: hanya 2 kolisi confirmed (FUL-001, FUL-007 — keduanya fixed di repo). Tidak ada POTENTIAL AMBIGUITY tersisa yang membutuhkan tindakan.

### Hasil pengukuran pass 2

- `npm test` worker: 55/55 (8 file) — rate-limit KV (4), voucher server (20), pin (5), webhook (7), team-login (4), admin-rbac (6), env-guards (6), affiliate-payout (3).
- `npx tsc --noEmit` worker: clean. Root (pass 1): 132 test PASS, lint 0 error.
- Migrasi: 57 file di repo (fix FUL-001 = 20260817020000); 2 migrasi sebelumnya ter-push ke prod + diverifikasi; **migrasi fix FUL-001 belum di-push ke prod (BLOCKED — tanpa kredensial)**.
- Deployment live: Worker profitku-api (KV binding RATE_LIMIT_KV terverifikasi), POS, Admin.
- CI: **semua hijau di `f0b4e76`** — Web ✅ API ✅ db-integration ✅ Deploy ✅ (run 31997936793).

---

## 13. WAIVER Phase 1 (2026-08-17) + catatan risiko

User secara eksplisit melewati gate untuk scope Phase 1 **terbatas**:
1. **SEC-001** — PIN cloud team SHA-256 → PBKDF2-SHA256 (`lib/pin.ts`, 10 call-site `routes/team.ts`, auto-upgrade hash legacy saat login).
2. **TST-001/002** — test worker billing: 8 file / 55 test (pin, webhook, team-login, admin-rbac, env-guards, affiliate-payout, rate-limit, vouchers) + vitest infra + CI api job.
3. **SEC-003 / BILL-006** — dev routes butuh flag; mock dilarang di production; cron wajib secret.
4. **SEC-004** — RLS subset `public_stores` (migrasi ter-push ke prod).
5. **BILL-004** — payout atomik via `fn_affiliate_payout_create` (migrasi ter-push ke prod).
6. **SEC-002** — rate limit lintas-isolate via Cloudflare KV (binding `RATE_LIMIT_KV`).
7. **TST-002 lanjutan** — integration test concurrency `fulfill_cloud_payment` (`tests/integration/fulfill-concurrency.mjs`, CI job `db-integration`).

**Risiko yang dicatat** (scope lain tetap terkunci gate):
- Concurrency `fulfill_cloud_payment` di level DB belum di-integration-test (hanya replay idempotency level Worker) — TST-002 sebagian.
- **MIGRASI WAJIB DI-PUSH MANUAL** (`supabase db push`): `20260817000000_store_public_subset.sql` + `20260817010000_affiliate_payout_atomic.sql` — deploy Worker via `npm run release` TIDAK menjalankan migrasi. Sampai migrasi terpasang: payout run mencatat error `function not found` (tidak ada duit hilang, tidak crash) dan `stores_public_read` lama masih aktif.
- Voucher server, webhook token-fallback, dan routes lain (stores/sync/backups/finance/master-data) belum dites.
- Keputusan manusia §11 (provider pembayaran; credit ledger; role support; Cloudflare Access; deploy gate; commit baseline) masih terbuka untuk item 2-7.
- Perubahan PIN tidak invalidasi sesi tim yang sudah aktif (token sesi 24 jam tidak berubah).

