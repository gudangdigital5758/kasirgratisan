# PROJECT STATUS

> Diperbarui dari evidence repository (audit 2026-08-17 + Phase 1 terbatas 2026-08-17). Phase 0 gate tetap NOT_COMPLETE untuk scope lain.

## Current state
Status: **PHASE 0 AUDIT (2 PASS) - WAIVER FASE 1 SELESAI - GATE MENUNGGU APPROVAL - FUL-001 TERBUKA (P1)**
Last verified: 2026-08-17
Evidence: `progress/PHASE-0-AUDIT.md` . `progress/SECURITY-AUDIT.md` . `progress/TEST-COVERAGE.md`

## Profitku
| Area | Status | Confidence | Notes |
|---|---:|---:|---|
| Customer app (POS PWA + Android) | VERIFIED | HIGH | Offline-first, Dexie, FIFO COGS, multi-user PIN, i18n, Capacitor parallel; Play ditunda |
| Billing (payment flow) | VERIFIED | HIGH | Harga/voucher server-side; fulfill atomik + idempotent (fulfill_cloud_payment(_batch)); webhook signature + amount check; SumoPod aktif di config, Midtrans dual-support; test webhook replay idempotent (2026-08-17) |
| Wallet (credit ledger) | SCHEMA ONLY | HIGH | Tabel+RPC ada (credit_accounts/credit_transactions/ai_jobs/topup_pending), grant service_role only - **tidak ada code path Worker** (dorman) |
| Subscription | VERIFIED | HIGH | Per toko (Rp 25.000/bln), durasi 1/6/12 (1/5/10), entitlement per toko, dunning H-3/H-1, guard 402 |
| AI Marketing | NOT FOUND (DOCUMENTATION ONLY) | HIGH | 0 kode di repo; hanya PRD/ADR/docs. Tidak ada metering, request_id, pricing Rp100/1M, wallet charge |
| Admin | VERIFIED (partial monitoring) | HIGH | SPA dashboard.profitku.my.id; RBAC admin_users + ADMIN_EMAILS; audit log; test RBAC (2026-08-17); **tidak ada** live logs/traffic/AI/MSC monitoring |
| Authentication | VERIFIED | HIGH | Supabase Auth Google; JWT divalidasi server fail-closed; tim cloud username+PIN ke sesi 24 jam - **PIN PBKDF2-SHA256 (SEC-001 resolved 2026-08-17), legacy hash auto-upgrade saat login** |
| Monitoring | PARTIALLY VERIFIED | MEDIUM | platform_events + admin events polling; tanpa alerting/agregasi log/health per provider |
| Team cloud (tim/roles) | VERIFIED | HIGH | cloud_team_members/roles/sessions, menu-based RBAC, POS verify; PIN PBKDF2 + rate limit test (2026-08-17) |
| Online kasir (F4) | VERIFIED | HIGH | checkout/debt/stock/shift/PnL via RPC atomik, harga server-side |
| Testing (worker) | VERIFIED (partial) | HIGH | 22 test baru (2026-08-17): webhook billing, PIN/team login, admin RBAC; sisa: concurrency RPC SQL, voucher, affiliate |

## MSC Studio
| Area | Status | Confidence | Notes |
|---|---:|---:|---|
| Image generation | NOT FOUND di repo ini | HIGH | ADR-002: repo terpisah; tidak ada di workspace |
| Video generation | NOT FOUND di repo ini | HIGH | - |
| Telegram bot | NOT FOUND di repo ini | HIGH | - |
| Browser automation | NOT FOUND (sesuai ADR-005) | HIGH | Tidak ada di repo ini - tidak perlu dihapus di sini |
| Authentication | NOT FOUND (target Google OAuth) | HIGH | Docs-only |
| VPS deployment | NOT FOUND (target state) | HIGH | docs/06-operations/VPS-MSC.md; tidak ada Docker/Redis/queue di repo |

## 9Router
| Area | Status | Notes |
|---|---|---|
| AI Marketing | NOT FOUND di code | Docs-only (ADR-003) |
| AI Coding | NOT FOUND di code | Docs-only |
| Per-user usage | NOT FOUND di code | Profitku-owned metering belum ada |
| Global reconciliation | NOT FOUND di code | Tidak ada data untuk di-reconcile |

## Rule
Item di atas ditandai hanya dengan evidence source code/migrations/tests/config. Dokumentasi tidak dianggap implementasi.

## Prioritas berikut (Phase 1, setelah gate)
1. ~~SEC-001 PIN → PBKDF2~~ **SELESAI 2026-08-17** (waiver parsial; lib/pin.ts + 10 call-site + test).
2. Test worker billing — **SELESAI 2026-08-17**: 55 test (webhook idempotency, signature, RBAC admin, team login/PIN, env guards, payout atomik, rate limit KV, voucher server) + CI api job. Integration concurrency `fulfill_cloud_payment` via CI job `db-integration` (menunggu verifikasi di GitHub).
3. ~~Tutup dev routes & mock guard prod~~ **SELESAI** (SEC-003 / BILL-006, live di prod).
4. ~~RLS subset `stores_public_read`~~ **SELESAI** (SEC-004, migrasi ter-push).
5. ~~Payout affiliate atomik~~ **SELESAI** (BILL-004, migrasi ter-push).
6. ~~Rate limit KV~~ **SELESAI** (SEC-002, binding RATE_LIMIT_KV).
7. Keputusan credit ledger (DEBT-002) — masih terbuka.
8. Dokumentasi provider pembayaran aktual (DEBT-003) — masih terbuka.

## Pass 2 (re-audit 2026-08-17)
- CI: Web/API/Deploy hijau di semua commit; job baru db-integration RED -> **FUL-001 (P1)**: fulfill_cloud_payment (migrasi 20260811110000_cloud_billing_atomic.sql) error 'column reference raw is ambiguous' di PG15 (variabel plpgsql raw vs kolom payments.raw). Prod UNVERIFIED (PAT dicabut). Fix butuh approval: rename variabel ke raw_json + re-push migrasi.
- Worker tests: 55/55 (8 file). Integration harness: 6 iterasi fix (path, roles, deps migrasi, auth stub, trigger profiles, pg params).
- Sekuritas tersisa: SEC-005..012 (P3), SEC-010 UNVERIFIED. Billing: BILL-001/002/003/005 terbuka (P2/P3).
- Keputusan §11 tersisa: credit ledger, provider pembayaran, role support, Cloudflare Access, deploy gate.

## FUL-001 EXECUTION (2026-08-17)
- Repository fix: **PASS** - migrasi 20260817020000_fix_fulfill_cloud_payment_raw.sql (rename raw->raw_json di fulfill_cloud_payment), commit f0b4e76.
- Integration test: **PASS** - CI db-integration GREEN (run 31997936793); 5 koneksi paralel, replay idempotent, owner mismatch, extend.
- Concurrency: **PASS** (5 concurrent connections, harness existing).
- Worker tests: **PASS** 55/55 x3 (FUL-002 fixed via fake timers). Lint/typecheck clean.
- Production function: **BLOCKED** - tidak ada kredensial Supabase (env + file token kosong); definisi prod tidak dapat dibaca.
- Production remediation: **BLOCKED** - migrasi fix belum di-push ke prod.
- End-to-end fulfillment (prod): **BLOCKED** - butuh kredensial + akun test. Level DB e2e sudah dibuktikan integration test.
- FUL-007 (P1, OPEN): fulfill_cloud_payment_batch punya pola ambiguity sama (batch_checkout.sql:189) - butuh migrasi fix terpisah + approval.

## FUL-007 EXECUTION (2026-08-17)
- Root cause: **PASS** - variabel plpgsql raw vs kolom payments.raw di SET raw = raw (batch_checkout.sql:189), identik FUL-001.
- Repository fix: **PASS** - migrasi 20260817030000_fix_batch_fulfillment_raw.sql (rename raw->raw_json), commit 034b999.
- Integration: **PASS** - CI GREEN (run 31998685184), test batch E-H (normal+replay, 5 concurrent, owner mismatch, item alien).
- Concurrency: **PASS** (5 parallel, payment baru).
- Production: **UNVERIFIED / BLOCKED** (tanpa kredensial).
- Ambiguity sweep: **SELESAI** - 32 function billing diperiksa; hanya FUL-001 + FUL-007 confirmed (keduanya fixed di repo); sisanya SAFE.
- Worker tests: 55/55 x3, typecheck clean, secret scan bersih.
- Local verification (2026-08-18): harness DB 3x PASS (embedded Postgres 18/UTF8; 21 asersi A-H, 0 FAIL; 1 run tanpa output = artefak tooling lokal port-5432, bukan repo). Fix dibuktikan pure rename via `scripts/verify-raw-rename.mjs`. Worker 55/55 x3, typecheck clean, lint 0 error.

## FUL-010 — SUMOPOD STATUS ENDPOINT INVALID (2026-08-18)
- Root cause: `getSumopodPaymentStatus` memanggil `GET /api-pay.sumopod.com/api/v1/payments/{orderId}` yang **tidak terdaftar** (404 `page not found` dengan key valid; hanya `POST /api/v1/payments` terbukti). Akibat: polling verify SumoPod tidak pernah sukses; error ditelan → PENDING menggantung tanpa jalur pulih; kontributor pola 9 PENDING (FUL-008).
- Status repository hardening: **DONE (repo)** — webhook amount wajib + dedupe event + audit trail platform_events + gate token fallback (SEC-012) + verifikasi error tercatat + cron stale-pending alert (default non-destruktif). Test worker 63/63 x3 (2026-08-18).
- Status endpoint fix: **BLOCKED** — butuh dokumentasi endpoint status dari dashboard merchant SumoPod (satu-satunya sumber otoritatif); tidak ada docs publik. Tanpa itu, tidak ada path yang benar untuk diverifikasi.
- FUL-009 (status 2 payment): tetap **BLOCKED** sampai endpoint benar + SUMOPOD_API_KEY tersedia lokal.
- Worker tests: 63/63 x3, typecheck clean, lint 0 error (2026-08-18). Production function tidak diubah.
