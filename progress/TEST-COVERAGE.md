# Test Coverage — Profitku

Status: **BASELINE + WORKER TESTS + INTEGRATION** (2026-08-17: root 26 file/132 test PASS · workers/api 8 file/55 test PASS · DB integration script untuk CI)

## Worker API (2026-08-17 — TST-001/002 + env guards + payout + rate limit + voucher)

Jalankan: `cd workers/api && npm test` (masuk CI api job). Infra: vitest (node env) + `worker.fetch()` dengan env & fetch Supabase di-mock. Total: 10 file / 63 test (2026-08-18: +8 test hardening FUL-010).

| File | Test | Cakupan |
|---|---|---|
| `tests/pin.test.ts` | 5 | PBKDF2 roundtrip, PIN/member salah, salt acak, legacy sha256 + needsRehash, format rusak |
| `tests/webhooks.test.ts` | 7 | Midtrans: signature valid + replay idempotent (alreadyDone), amount mismatch → 400 tanpa fulfill, signature invalid → 401, order tak dikenal → skipped; SumoPod: Svix valid → COMPLETED, invalid → 401, event test ack |
| `tests/team-login.test.ts` | 4 | Legacy hash → login + auto-upgrade ke pbkdf2$, PIN pbkdf2 langsung, PIN salah 401, rate limit 10/menit → 429 |
| `tests/admin-rbac.test.ts` | 6 | resolveAdmin (tabel vs ADMIN_EMAILS vs bukan staff), /admin/api/me 200/403/401 |
| `tests/env-guards.test.ts` | 6 | SEC-003: dev route 403 tanpa flag / 200 dengan flag; BILL-006: checkout/checkout-batch/verify mock+production → 503 tanpa payment dibuat; cron tanpa secret di production → 403 |
| `tests/affiliate-payout.test.ts` | 3 | BILL-004: RPC `fn_affiliate_payout_create` dipanggil dengan semua komisi & tanpa insert langsung; periode existing → skipped; RPC skipped → tidak dihitung |
| `tests/rate-limit.test.ts` | 4 | SEC-002: KV fixed-window (blokir setelah max, bucket reset, key terpisah), fallback in-memory |
| `tests/vouchers.test.ts` | 20 | computeEffect (percent/free_days/lifetime, clamp), periode (extend dari period_end, lifetime, duration), validateVoucherForUser (nonaktif, window waktu, plan mismatch, kuota, max_per_user, first_time_only, valid), recordRedemption payload |
| `tests/verify-payment.test.ts` | 1 | 2026-08-18: `GET /api/payments/verify/:id` SumoPod saat status lookup gagal → tetap PENDING + `payment.verify_sumopod_error` tercatat (FUL-010 hardening) |
| `tests/cron-stale.test.ts` | 3 | 2026-08-18 `POST /api/cron/stale-pending`: default alert-only non-destruktif, `AUTO_FAIL_STALE_PENDING=true` → FAILED, production tanpa secret → 403 |
| `tests/cors.test.ts` | 5 | 2026-08-19 SEC-007: ACAO `profitku-admin.pages.dev` + preview ✓; project tak terpakai/attacker ✗ (ACAO default); custom domain admin ✓ |
| `tests/cron-hmac.test.ts` | 4 | 2026-08-19 SEC-011: HMAC valid jalan, legacy header ditolak setelah HMAC aktif, replay >5 menit ditolak, signature lintas-path ditolak |
| `tests/health.test.ts` | 3 | 2026-08-19 SEC-006: production default subset aman (tanpa provider/config), `?full=1` detail penuh, non-production detail penuh |
| `tests/team-session.test.ts` | 3 | 2026-08-19 SEC-005: login simpan token_hash (bukan plaintext) + DELETE expired; logout revoke via token_hash; logout tanpa token 401 |

**Hardening FUL-010 (2026-08-18, repo):** webhook SumoPod kini (a) wajib `amount` pada event paid (fail-closed 400), (b) dedupe event via `request_id` (svix-id/body.id) sebelum fulfill, (c) audit trail `webhook.sumopod` ke `platform_events` (menutup gap FUL-008), (d) gate SEC-012 `SUMOPOD_ALLOW_TOKEN_FALLBACK=false` (default backward-compat + warn), dan (e) verifyPayment SumoPod mencatat error status-lookup ke platform_events. Cron `flagStalePendingPayments` (deteksi PENDING >48 jam, alert-only default). Test `team-login` rate-limit diberi timeout 30s (flake FUL-002: 11× PBKDF2 >5s default vitest pada mesin lambat).

## DB integration (TST-002 — concurrency RPC SQL)

`tests/integration/fulfill-concurrency.mjs` — butuh Postgres 15 (service postgres di CI; lokal via docker). Menjalankan migrasi inti (init + vouchers + per_store_subscription + cloud_billing_atomic + fix FUL-001 + fix FUL-007 + seed) lalu:
- A: 5 fulfill CONCURRENT payment sama → tepat 1 pemenang, 1 subscription aktif.
- B: replay → alreadyDone tanpa grant ganda.
- C: owner mismatch ditolak.
- D: payment kedua toko sama → extend, bukan duplikat.
- E: batch fulfillment 2 toko + replay idempotent (FUL-007).
- F: batch CONCURRENT (5 paralel, payment baru) → 1 pemenang.
- G: batch owner mismatch ditolak.
- H: batch dengan item toko alien → dilewati (fulfilledCount=1).

CI: **GREEN** — run 31997936793 (FUL-001 fix) dan 31998685184 (FUL-007 fix + test batch E-H). Prod: UNVERIFIED / remediation BLOCKED (tanpa kredensial Supabase). FUL-002 (test bucket rate-limit) diperbaiki dengan fake timers — 3× run 55/55.

Lokal (2026-08-18): harness dijalankan 3× terhadap embedded Postgres 18 (UTF8, tanpa docker) — **ALL INTEGRATION TESTS PASSED 3×**, 0 FAIL (21 asersi A–H per run). Catatan 1 run tanpa output: artefak tooling lokal (postgres sisa memegang port 5432), bukan kegagalan harness/repo. Fix FUL-001 + FUL-007 dibuktikan behavior-identical via `scripts/verify-raw-rename.mjs` (reverse-rename body function → identik dengan migrasi asli). Worker suite 55/55 3× (2026-08-18).

**Bukti fail-on-buggy (2026-08-18)**: migrasi asli `20260812150000_batch_checkout.sql` dijalankan terhadap Postgres kosong → pemanggilan `fulfill_cloud_payment_batch` gagal dengan `ERROR: column reference "raw" is ambiguous` (context: `UPDATE public.payments ... raw = raw`). Dengan migrasi fix `20260817030000` → seluruh test E–H PASS. Artinya test memang gagal di versi buggy dan pass di versi fixed.

## Baseline

| Item | Hasil |
|---|---|
| Framework | Vitest 4 (jsdom), globals, setup `src/test/setup.ts`, include `src/**` + `tests/**` |
| Jumlah test (root) | 132 pass, 0 fail, 0 skip |
| Lint | `npm run lint` 0 error / 26 warning (react-refresh) + guard-links OK |
| Typecheck worker | `npx tsc --noEmit` clean (src + tests) |
| CI | web: lint+typecheck+test+build · api: tsc + test · deploy main-only + smoke curl |

## Yang sudah dicover (VERIFIED)

| Area | File | Test |
|---|---|---|
| Cart & pricing | `cart-math`, `pricing`, `vouchers-pricing`, `change-counter`, `product-fields`, `product-import` | 47 |
| FIFO/HPP | `fifo` | 4 |
| Cashier ops & shift | `cashier-ops` | 6 |
| Backup lokal/cloud | `backup`, `local-backup`, `cloud-backup` | 14 |
| Sync (push/pull/pagination/two-device/LWW/tombstone/schema/m0) | `sync*` (12 file) | 43 |
| Roles/permissions & affiliate client | `roles`, `affiliate` | 11 |
| Printer | `printer` | 4 |
| Admin boundary (token refresh, settings validation) | `tests/admin-boundaries` | 4 |
| Store registry | `store-registry` | 8 |
| Contoh/setup | `example` | 1 |

## Gap kritis (P1 — wajib ditutup sebelum billing/AI Phase 1)

- [x] **Worker API tests** — 4 file / 22 test (2026-08-17): webhook billing, team login/PIN, admin RBAC. `routes` lainnya (stores, sync, backups, finance, master-data) masih tanpa test.
- [~] **Billing fulfillment** — replay webhook idempotent dites di level Worker (alreadyDone); **concurrency RPC SQL** (`fulfill_cloud_payment` paralel) masih butuh integration test DB.
- [ ] **Webhook signature** — Midtrans SHA512 valid/invalid + replay OK; SumoPod HMAC valid/invalid + token fallback belum dites.
- [ ] **Voucher server** — validasi (first_time_only, max per user, expired), redemption idempotent, efek free_days/lifetime/percent.
- [ ] **Affiliate** — komisi per tier idempotent, atribusi window, payout run idempotent + atomik (BILL-004), PPh 23.
- [ ] **RBAC admin** — requireAdmin, canWrite/canMutateBilling per role, admin_users CRUD superadmin-only, audit log ditulis.
- [ ] **Team auth** — login/verify PIN (brute-force rate limit), sesi 24 jam, revoke, menu guard per role.
- [ ] **Sync RPC** — `sync_upsert_batch` LWW, winner ack, keyset pagination, quota (max records/bytes).
- [ ] **Backup quota reservation** — race upload paralel, expiry, cleanup.

## Gap menengah (P2)

- [ ] Migrasi SQL test (jalankan migrasi ke Postgres kosong → schema valid; idempotent re-run).
- [ ] E2E smoke (POS login → checkout offline → sync → cloud dashboard) — CI saat ini hanya curl.
- [ ] Test `fn_online_checkout`/`fn_online_debt_payment`/`fn_online_stock_move`/`fn_online_close_shift`/`fn_online_pnl` (race-safe, stok negatif, overpay).
- [ ] Test concurrency topup/charge credit (bila wallet diaktifkan Phase 5).

## Catatan

- Tidak ada test untuk `workers/api` sama sekali — seluruh jalur uang (payment, voucher, affiliate, subscription) berjalan tanpa jaring pengaman otomatis. Prioritas #1.
- Test frontend menutup logika POS offline & sync dengan baik (sync 12 file, 43 test).

