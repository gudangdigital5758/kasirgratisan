# Test Coverage — Profitku

Status: **BASELINE RECORDED** (diukur 2026-08-17: `npm test` → 26 file / 132 test PASS)

## Baseline

| Item | Hasil |
|---|---|
| Framework | Vitest 4 (jsdom), globals, setup `src/test/setup.ts`, include `src/**` + `tests/**` |
| Jumlah test | 132 pass, 0 fail, 0 skip |
| Lint | `npm run lint` 0 error / 26 warning (react-refresh) + guard-links OK |
| Typecheck worker | `npx tsc --noEmit` clean |
| CI | web: lint+typecheck+test+build · api: tsc · deploy main-only + smoke curl |

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

- [ ] **Worker API tests** — 0 test untuk seluruh `workers/api/src` (auth middleware, guards, checkout, verify, history, stores, sync routes, backups, team, admin).
- [ ] **Billing fulfillment** — idempotency `fulfill_cloud_payment(_batch)` (replay webhook, double-call), concurrency (2 webhook paralel), amount mismatch, owner mismatch, provider mismatch, legacy-repair path.
- [ ] **Webhook signature** — Midtrans SHA512 valid/invalid, SumoPod Svix HMAC + token fallback, replay.
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

