# PROJECT STATUS

> Diperbarui dari evidence repository (audit 2026-08-17 + Phase 1 terbatas 2026-08-17). Phase 0 gate tetap NOT_COMPLETE untuk scope lain.

## Current state
Status: **PHASE 0 AUDIT DILAKSANAKAN - WAIVER PARSIAL (SEC-001 + TST-001/002) - GATE MENUNGGU APPROVAL PENUH**
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
1. ~~SEC-001 PIN ke PBKDF2~~ **SELESAI 2026-08-17** (waiver parsial; lib/pin.ts + 10 call-site + test).
2. Test worker billing - **SELESAI 2026-08-17**: 22 test (webhook idempotency, signature, RBAC admin, team login/PIN) + CI api job. Sisa: concurrency RPC SQL (integration test DB), voucher server, affiliate payout atomik.
3. Tutup dev routes & mock guard prod (SEC-003 / BILL-006).
4. RLS subset stores_public_read (SEC-004).
5. Payout affiliate atomik (BILL-004).
6. Keputusan credit ledger (DEBT-002).
7. Dokumentasi provider pembayaran aktual (DEBT-003).