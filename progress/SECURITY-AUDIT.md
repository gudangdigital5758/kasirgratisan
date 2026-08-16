# Security Audit — Profitku

Status: **FINDINGS RECORDED** (audit 2026-08-17, berbasis source code/migrations/config/CI)

> Kontrol dinyatakan implemented hanya setelah diverifikasi dari source/deployment evidence.
> Skala severity: P0 = Critical, P1 = High, P2 = Medium, P3 = Low.

## Kontrol yang terverifikasi POSITIF

| Kontrol | Evidence |
|---|---|
| Service role hanya di Worker | `workers/api/src/lib/supabase.ts` (headers service role); frontend hanya anon key (`src/lib/supabase-client.ts`, `admin/src/lib/supabase.ts`) |
| JWT divalidasi server-side, fail-closed | `index.ts:123-162` — `/auth/v1/user`; tanpa validasi → userId null |
| Tidak ada secret ter-commit | Scan `git ls-files` + regex (`eyJ…`, `sk-`, `whsec_`, `AKIA`): hanya nilai publik (anon key, Google Client ID, OneSignal App ID) di `ci.yml`/`admin/wrangler.toml`/`docs/archive` |
| RLS menyeluruh | Semua tabel `enable row level security`; tabel admin/voucher/affiliate/sync/credit tanpa policy client |
| RPC sensitif revoke public/anon/authenticated | `cloud_scope_hardening.sql`, `cloud_billing_atomic.sql:187-190`, `per_store_subscription.sql:60-63` |
| Webhook signature + amount check | Midtrans SHA512 (`midtrans.ts:143`), SumoPod Svix HMAC (`sumopod.ts:82`), amount mismatch → 400 (`index.ts:423`, `index.ts:578`) |
| Backup scoped per user/store | `backups.ts` `getBackupMeta` filter `user_id`; team via `store_id` + menu guard |
| CORS allowlist | `index.ts:94-121` origin list + pages preview regex; non-allowlist → default origin |
| Rate limit webhook & login | webhook 60/menit, issue-report 10/menit, team login/verify 10/menit/IP |
| Log tidak memuat PII/secret | `index.ts:296-301, 317-320, 338-340` — payload disimpan ringkas, isi laporan tidak di-log |
| Google Play billing dimatikan | `payments.ts:949-951` → 410 |
| Admin audit log | `admin.ts:86-108` `writeAudit` di mutasi admin |
| Maintenance mode fail-closed | `index.ts:174-206` — 503 kecuali admin/cron |

## Findings

| ID | Severity | Component | Current state | Evidence | Risk | Recommended action | Affected files | Confidence |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | P1 | Team login PIN | VERIFIED | `routes/team.ts:226-229` `sha256Hex(pin:member.id)` — SHA-256 tanpa KDF; PIN 4–6 digit (ruang 10⁴–10⁶); compare string non-timing-safe | Jika DB bocor, PIN di-brute-force offline dalam hitungan detik; kredensial tim cloud + POS | PBKDF2 (WebCrypto) + salt random per member + iterasi tinggi; timing-safe compare; migrasi hash bertahap | `workers/api/src/routes/team.ts`, migrasi baru | HIGH |
| SEC-002 | P2 | Rate limiting | VERIFIED | `lib/rate-limit.ts` Map in-memory per-isolate (dictatat penulis: "pindah ke KV/DO") | Bypass limit saat Worker multi-isolate; abuse login/checkout/webhook | Cloudflare KV / Durable Object counter | `workers/api/src/lib/rate-limit.ts`, `wrangler.toml` | HIGH |
| SEC-003 | P2 | Dev endpoints | VERIFIED | `routes/dev.ts` `/dev/notify-test` tanpa auth; gate hanya `PAYMENT_PROVIDER=mock` | Di env mock/staging siapa pun bisa spam email/WA/push (cost, phishing dari domain resmi) | Mount hanya saat env dev eksplisit; atau require admin; atau hapus | `workers/api/src/routes/dev.ts`, `index.ts:250` | HIGH |
| SEC-004 | P2 | RLS stores | VERIFIED | `init_profitku.sql:296-298` `stores_public_read` = seluruh kolom store (termasuk alamat, `qris_id`); komentar "subset via RPC later" tidak ada implementasinya | PII toko & QRIS publik saat `is_public=true` | View/RPC subset kolom untuk katalog publik | `init_profitku.sql` + migrasi baru | HIGH |
| SEC-005 | P3 | Sesi tim | VERIFIED | `cloud_team_sessions` token plaintext, 24 jam, tanpa rotasi/revoke endpoint | Token dicuri → sesi aktif tanpa revoke cepat | Hash token di DB; endpoint revoke; cleanup eager | `routes/team.ts`, migrasi | MEDIUM |
| SEC-006 | P3 | Info disclosure | VERIFIED | `index.ts:252-266` `/health` publik bocorkan provider aktif + status konfigurasi | Info disclosure minor | Batasi di production atau hapus detail | `index.ts` | HIGH |
| SEC-007 | P3 | CORS | VERIFIED | `index.ts:114` regex izinkan semua subdomain `*.profitku-cloud-dashboard.pages.dev` | Subdomain takeover pages.dev → origin trusted untuk CORS | Kunci ke project name spesifik | `index.ts` | MEDIUM |
| SEC-008 | P3 | RLS cloud_team_members | PARTIALLY VERIFIED | `20260813160000_cloud_team_members.sql` policy owner; detail policy select non-owner belum diverifikasi penuh | Eksposur `pin_hash` antar anggota (relevan SEC-001) | Audit policy; revoke select `pin_hash` dari client | migrasi team | MEDIUM |
| SEC-009 | P3 | Timing compare PIN | VERIFIED | `team.ts:293,349,704` perbandingan string | Timing side-channel (teoritis via network) | `crypto.subtle` timing-safe / bandingkan digest penuh | `routes/team.ts` | LOW |
| SEC-010 | P2 | Account lifecycle | UNVERIFIED | Tidak ditemukan endpoint export/hapus data user di Worker | Kepatuhan UU PDP (hak akses/hapus) | Verifikasi + tambah endpoint delete/export + dokumentasi retensi | worker routes | MEDIUM |
| SEC-011 | P2 | Cron manual | VERIFIED | `routes/cron.ts` guard `WEBHOOK_SECRET` header (bukan signature) | Secret statis di header; replay/leak → trigger cron | Pindah ke signature HMAC per-request atau panggil via `scheduled()` saja | `routes/cron.ts` | MEDIUM |
| SEC-012 | P3 | Webhook fallback token | VERIFIED | `sumopod.ts:127-130` `X-Webhook-Token` sebagai alternatif verifikasi (nilai statis) | Token statis bocor → forge webhook | Wajibkan Svix HMAC; nonaktifkan fallback token | `lib/sumopod.ts`, `index.ts:514-524` | MEDIUM |

## Catatan tambahan

- `stores_public_read` + `qris_id` (migrasi `20260816230000_store_qris.sql`) saling terkait — QRIS statis toko terekspos publik jika toko `is_public`.
- Provider webhook: SumoPod aktif di `wrangler.toml` (`PAYMENT_PROVIDER=sumopod`) — verifikasi secret `SUMOPOD_WEBHOOK_SECRET` ter-set di prod, bukan hanya token fallback.
- Rate limit global `/api/*` = 120/menit/user-IP per isolate — lihat SEC-002.

