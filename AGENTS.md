# Profitku Agent Instructions

Instruksi **khusus repo Profitku (kasirgratisan)**. Dokumen ini menggabungkan aturan repo Profitku yang sudah ada dengan AI bootstrap protocol, Phase 0 gate, security/financial guardrails, dan routing ke documentation pack.

> **PRIORITAS:** Isi repository yang benar-benar ada tetap menjadi source of truth untuk current state. Dokumentasi mendefinisikan target/keputusan, tetapi tidak boleh dianggap sebagai bukti implementasi tanpa verifikasi kode.

---

# 1. AI BOOTSTRAP PROTOCOL

## New Session Bootstrap

Di awal chat/sesi baru untuk repo ini, **sebelum coding / patch / operasi tulis**:

1. Baca `README.md`.
2. Baca `AGENTS.md` ini sampai selesai.
3. Baca `AI_MASTER_IMPLEMENTATION_PLAN.md` jika tersedia.
4. Baca `PROJECT_STATUS.md` jika tersedia.
5. Baca `PHASE-0-GATE.md` jika tersedia.
6. Baca dokumentasi stabil Profitku yang sudah ada:
   - `docs/profitku-cloud.md`
   - `docs/ARCHITECTURE.md`
   - `docs/DECISIONS.md`
   - `docs/android-google-signin.md`
   - `workers/api/README.md`
7. Jika Documentation Pack baru sudah dipasang, baca:
   - `docs/00-overview/*`
   - `docs/01-prd/*`
   - `docs/02-architecture/*`
   - `docs/03-api/*`
   - `docs/04-database/*`
   - `docs/05-security/*`
   - `docs/06-operations/*`
   - `docs/07-decisions/*`
   - `progress/*`
8. Jika kerja API/cloud: skim `workers/api/README.md` dan `workers/api/src/index.ts` (entry).
9. Baca `src/lib/brand.ts` (nama, domain, paket, Play flag).
10. Jalankan `git status --short` dan ringkas branch.
11. Jika ada `PROJECT_STATE.md` lokal: anggap **continuity saja**, bisa usang — bukan source of truth.
12. Ringkas:
    - current project state;
    - Git state;
    - Phase 0 state;
    - risiko relevan;
    - next step yang disarankan.

### Efisiensi context

AI **tidak wajib membaca seluruh dokumentasi dari awal setiap task** setelah bootstrap pertama selesai.

Setelah Phase 0 baseline tersedia:
- baca PRD yang relevan;
- baca architecture yang relevan;
- baca API/database/security docs yang relevan;
- baca ADR yang terkait;
- inspeksi source code aktual.

Jika ada perubahan arsitektur besar, dokumentasi berubah material, atau Phase 0 dinyatakan stale, lakukan re-audit.

---

# 2. PHASE 0 GATE — IMPLEMENTATION LOCK

## Aturan absolut

Jika `PHASE-0-GATE.md` tersedia dan Phase 0 belum berstatus `COMPLETE`, maka **implementation work diblokir**.

Sebelum Phase 0 complete, AI hanya boleh:
- membaca;
- mencari;
- menganalisis;
- mengaudit;
- membuat laporan;
- memperbaiki dokumentasi audit;
- membuat test/audit tooling yang tidak mengubah production behavior, jika memang diperlukan untuk audit.

AI **tidak boleh**:
- refactor source;
- mengubah billing/wallet;
- mengubah authentication;
- mengubah API;
- mengubah database production;
- menghapus fitur;
- melakukan migrasi destruktif;
- deploy production;
- mengubah production configuration.

### Required Phase 0 outputs

Jika gate belum complete, targetkan:

- `progress/PHASE-0-AUDIT.md`
- `progress/SECURITY-AUDIT.md`
- `progress/TEST-COVERAGE.md`
- `PROJECT_STATUS.md`
- architecture gap findings
- technical debt findings
- verified implementation inventory

Phase 0 hanya boleh ditandai `COMPLETE` jika ada evidence dari source code, configuration, tests, migrations, atau deployment yang relevan.

> Jika `PHASE-0-GATE.md` belum ada, gunakan aturan Phase 0 di `AI_MASTER_IMPLEMENTATION_PLAN.md` sebagai default dan **jangan menganggap Phase 0 sudah selesai** hanya karena file gate belum dibuat.

---

# 3. APPROVAL CODES

Kode berikut setara **izin eksekusi**:

| Kode | Arti |
|------|------|
| **`1526`** | Approve / izinkan eksekusi |
| **`5647`** | Approve / izinkan eksekusi |

Setara teks:
`APPROVE`, `EKSEKUSI`, `EXECUTE`, `APPLY PATCH`.

Juga dihitung approve jika user jelas meminta implementasi langsung, misalnya:
- “lanjutkan”
- “implementasikan X”
- “buat file Y”
- “tambahkan aturan Z”

**Bukan approve:** pertanyaan, audit, “apa langkah selanjutnya?”, “jelaskan saja?”, atau angka lain.

### Override Phase 0

Approval user untuk implementasi **tidak otomatis menghapus Phase 0 gate**.

Jika Phase 0 belum complete, perintah implementasi harus diperlakukan sebagai permintaan yang tertahan oleh gate. AI harus menjalankan audit terlebih dahulu, kecuali user secara eksplisit menyatakan bahwa Phase 0 boleh dilewati dan AI menjelaskan risikonya.

---

# 4. SOURCE OF TRUTH

## Current state

Source of truth current state adalah:
1. source code yang benar-benar ada;
2. tracked configuration;
3. database migrations/schema;
4. tests;
5. deployment/infrastructure configuration yang dapat diverifikasi.

Dokumentasi tidak boleh digunakan untuk mengklaim fitur sudah ada tanpa evidence.

`PROJECT_STATE.md` (jika ada) hanya continuity lokal agent; jangan di-commit kecuali user secara eksplisit menginginkannya.

## Stable Profitku documentation

Prioritaskan:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/profitku-cloud.md`
- `docs/DECISIONS.md`
- `docs/android-google-signin.md`
- `workers/api/README.md`
- `supabase/migrations/*`
- `supabase/seed.sql`
- `src/lib/brand.ts`

## New Documentation Pack

Jika tersedia, gunakan:
- `AI_MASTER_IMPLEMENTATION_PLAN.md`
- `docs/00-overview/*`
- `docs/01-prd/*`
- `docs/02-architecture/*`
- `docs/03-api/*`
- `docs/04-database/*`
- `docs/05-security/*`
- `docs/06-operations/*`
- `docs/07-decisions/*`
- `progress/*`

Jika ada konflik antara target documentation dan source code:
1. jangan diam-diam memilih;
2. laporkan discrepancy;
3. update `PROJECT_STATUS.md` / audit;
4. gunakan ADR/keputusan user sebagai authority untuk target architecture.

---

# 5. ARCHITECTURE BOUNDARIES

| Boundary | Aturan |
|----------|--------|
| **POS offline** | `src/` — React + Vite + Dexie. Kasir, stok, laporan, multi-user PIN harus jalan tanpa cloud. |
| **Cloud API** | `workers/api` — Hono di Cloudflare Workers. Secrets (service role, Fonnte, Resend, payment) hanya di Worker env/secrets. |
| **Cloud DB** | `supabase/` — migrasi + seed; RLS dihormati; service role hanya di Worker. |
| **Client cloud auth** | Supabase Auth (access/refresh). Production: jangan andalkan Google ID JWT long-lived di `localStorage`. |
| **Brand / domain** | `profitku.my.id`, `api.profitku.my.id`, appId `com.profitku.app`. |
| **Paket** | Satu plan: `cloud_monthly` / **Rp 25.000**/bulan (`BRAND.cloudPriceIdr`). Jangan reintro multi-tier tanpa keputusan di `DECISIONS.md`. |
| **Play Store** | `BRAND.playStoreEnabled === false` — listing ditunda; jangan hidupkan alert/billing Play tanpa update flag + decision. |
| **Data lokal user** | IndexedDB `kasirgratisan-db` dan key session legacy: jangan diganti sembarangan (bisa menghapus data toko user). |
| **i18n** | String UI lewat `src/i18n/locales/{id,en,ms}/` — jangan hardcode teks user-facing baru tanpa terjemahan. |

Frontend **tidak** boleh memuat `SUPABASE_SERVICE_ROLE_KEY`, `FONNTE_TOKEN`, `RESEND_API_KEY`, atau kunci payment.

---

# 6. PRODUCT + BUSINESS PRINCIPLES

1. **Kasir gratis offline dulu** — fitur cloud tidak boleh memblokir jual-beli tanpa internet.
2. **Cloud opsional berbayar** — backup/sync/notif; jujur di UI.
3. **Server tidak percaya harga/nominal sensitif dari client** untuk billing cloud; status langganan dari backend.
4. **Atomicity** — checkout/stok: utamakan transaksi Dexie multi-table; hindari partial write.
5. **Jangan overpromise multi-device** sampai sync pull/conflict siap.
6. **Profitku adalah customer billing authority.**
7. **AI Marketing awal: Rp100 / 1.000.000 token**, configurable dan tidak boleh hardcode di frontend.
8. Per-user AI usage harus dapat ditelusuri dengan `user_id` + `request_id`.
9. 9Router global usage adalah data reconciliation, bukan sumber tunggal billing per user.
10. MSC adalah media-generation infrastructure; Profitku memiliki pricing/customer billing.
11. Margin commercial Profitku terhadap biaya MSC/provider mengikuti keputusan bisnis yang terdokumentasi; jangan mengarang pricing baru.

---

# 7. 9ROUTER BOUNDARY

9Router **hanya** digunakan untuk:

```text
Profitku AI Marketing → 9Router → LLM
AI Coding              → 9Router → LLM
```

9Router **bukan**:
- image provider router;
- video provider router;
- Telegram provider router;
- bagian dari MSC media-provider abstraction.

Per-user AI Marketing metering dilakukan oleh Profitku.

Normalized usage:
```text
input_tokens
cache_tokens
output_tokens
total_tokens
reasoning_tokens (optional)
measurement_source
is_estimated
```

Prioritas measurement:
1. provider/9Router usage;
2. normalized gateway usage;
3. local tokenizer estimate;
4. jika estimate digunakan, wajib ditandai `is_estimated=true`.

Billing flow:
```text
request
→ estimate
→ reserve wallet
→ 9Router
→ actual usage
→ capture
→ release excess
```

Retry tidak boleh menyebabkan double billing.

---

# 8. MSC BOUNDARY

MSC Studio adalah domain/infrastruktur terpisah untuk:
- image generation;
- video generation;
- Telegram generation;
- media providers;
- workers/queues.

Target:
- production tidak bergantung pada PC developer;
- pindah ke VPS;
- Docker;
- Redis;
- monitoring;
- service-to-service authentication;
- browser automation dihapus sesuai audit/refactor plan.

Profitku berkomunikasi dengan MSC melalui stable authenticated API contract.

Jangan membawa domain/path/stack MSC ke Profitku kecuali memang diperlukan oleh kontrak integrasi.

---

# 9. BILLING / WALLET SAFETY — P0

Billing, wallet, subscription, AI charging, media charging, reservation, capture, release, refund, dan ledger adalah area **P0**.

Wajib:
- idempotency;
- atomic transaction;
- concurrency safety;
- immutable/auditable financial history;
- no negative balance;
- no double charge;
- explicit failure semantics;
- tests before/with behavior changes.

Jangan mengubah financial behavior berdasarkan asumsi.

Sebelum perubahan billing:
1. baca PRD billing;
2. baca billing architecture;
3. baca ledger/metering docs;
4. inspect implementation;
5. buat/update tests;
6. baru implementasi.

---

# 10. SECURITY GUARDRAILS

- Jangan commit `.env`, keystore, `*.jks`, service role, API keys, atau secret.
- Jangan expose secrets ke frontend.
- Jangan log token/API key/password.
- Admin authorization wajib server-side.
- Google OAuth harus diikuti authorization/RBAC.
- Service-to-service API harus authenticated.
- Redis tidak boleh exposed public tanpa kebutuhan yang sangat jelas dan kontrol kuat.
- Rate limiting untuk endpoint sensitif.
- Validate external input.
- Review SSRF/file upload/webhook risks jika relevan.
- Jangan bypass security hanya agar feature “jalan”.
- Destructive DB (drop production/data loss) membutuhkan konfirmasi eksplisit.
- Jangan `rm -rf` massal atau `git reset --hard` tanpa konfirmasi.
- Jangan menyerang sistem eksternal; exploit/malware out of scope.

---

# 11. VALIDATION EXPECTATIONS

Setelah perubahan kode (bukan pure Q&A):

| Area | Perintah |
|------|----------|
| Lint app | `npm run lint` |
| Unit test | `npm test` |
| Build web | `npm run build` |
| Worker types | `cd workers/api && npx tsc --noEmit` (atau `npm run typecheck`) |
| Diff hygiene | `git diff --check` jika tersedia |

Jika command tidak tersedia atau gagal karena environment:
- jangan mengarang hasil;
- laporkan command;
- laporkan error;
- jelaskan apa yang masih belum tervalidasi.

Dokumentasi-only: `git diff --check` biasanya cukup.

---

# 11A. AI AGENT ROLE SYSTEM

The AI coding workflow uses explicit roles:

1. Analyst
2. Planner / Architect
3. Executor
4. Code Reviewer
5. Tester
6. Test Result Reviewer
7. Security / Financial Reviewer
8. Final QA

All roles may initially use DeepSeek V4 Flash through 9Router.

Read:
- `AI_AGENT_ARCHITECTURE.md`
- `AI_AGENT_ROLES.md`
- `AI_ORCHESTRATOR.md`
- `AI_AUTONOMOUS_ENGINEERING_LOOP.md`
- `AI_QUALITY_GATES.md`
- `AI_AGENT_CONTEXT_PROTOCOL.md`
- `AI_AGENT_USAGE_METERING.md`

The same model must not be treated as evidence of correctness. Role separation, context isolation, adversarial review, tests, and quality gates provide independent checks.

# 11B. AUTONOMOUS ENGINEERING LOOP

For implementation tasks, after approval and Phase 0 clearance:

```text
IMPLEMENT
→ REVIEW
→ TEST
→ REVIEW TEST RESULT
→ FIX
→ REVIEW
→ TEST
→ ...
→ SECURITY REVIEW
→ FINAL QA
→ GREEN
```

Default maximum autonomous repair iterations: **10**.

If tests fail:
1. diagnose the failure;
2. classify the failure;
3. repair only when evidence indicates a code/test/config issue;
4. rerun review and tests.

Never:
- delete tests to obtain GREEN;
- weaken assertions without documenting why;
- disable lint/typecheck/security checks;
- make speculative broad refactors because of one failure;
- modify production logic to hide an environment failure.

If 10 repair iterations are exhausted, STOP and report evidence and unresolved issues.

## No-Fake-Green

A task is not GREEN because:
- one test passed;
- compilation succeeded;
- the AI believes the code is correct.

GREEN requires all applicable quality gates to PASS and Final QA to approve.

## Financial Safety Gate

For billing/wallet/subscription/AI charging/media charging/ledger tasks, add:
- idempotency review;
- concurrency review;
- reserve/capture/release review;
- retry/replay review;
- negative-balance review;
- ledger integrity review.

## AI usage boundary

`AI_CODING` usage is internal and must not be charged as `AI_MARKETING`.

# 12. TASK EXECUTION PROTOCOL

Untuk setiap implementation task:

## Step A — Understand
- classify task;
- check Phase 0;
- read relevant docs;
- inspect source.

## Step B — Plan
- identify affected files;
- identify data/API/security implications;
- identify tests;
- identify rollback/migration risk.

## Step C — Implement
- smallest safe change;
- preserve existing behavior unless change is intentional;
- do not invent architecture.

## Step D — Validate
- run relevant tests/lint/build;
- inspect diff;
- security check.

## Step E — Document
- update relevant docs;
- update progress/status;
- record architectural decision if needed.

## Step F — Report
- summarize changes;
- report tests;
- report unresolved risks;
- provide commit message.

---

# 13. CLOSING — SUMMARY + GIT COMMIT

Di akhir setiap turn yang menyelesaikan implementasi, fix, refactor, docs, atau perubahan file ter-track lainnya (bukan pure Q&A / audit read-only tanpa edit), selalu berikan dua blok:

### 1. Ringkasan kerja
Singkat, bahasa jelas: apa yang diubah, kenapa, dampak user/dev. Bullet 3–8 poin jika perlu.

### 2. Git commit — Summary + Description

Format:

```text
### Commit summary (subject)
<satu baris imperatif, ≤72 karakter, conventional commit jika cocok>

### Commit description (body)
<2–6 baris: apa + mengapa; file/area utama; breaking change jika ada>
```

Aturan:
1. Subject selalu ada; imperatif; `feat|fix|docs|refactor|chore|test(scope): …` jika cocok.
2. Body selalu ada setelah perubahan berarti.
3. Berdasarkan diff aktual, bukan template generik.
4. Jangan `git commit`, `git push`, force-push, atau deploy production kecuali user meminta eksplisit.
5. Jika tidak ada perubahan ter-track, katakan tidak perlu commit.
6. Gunakan code fence agar mudah dicopy.

---

# 14. OUT OF SCOPE

Jangan mengasumsikan atau men-scaffold:
- Leonardo;
- SnapGen sebagai domain internal Profitku;
- Tele Queue;
- `functions/api/*` Pages shape MSC;
- `telegram-automator/`;
- portal B2B member catalog;

kecuali memang dibutuhkan oleh kontrak integrasi yang telah diverifikasi.

---

# 15. DOCUMENTATION MAINTENANCE

Dokumentasi bukan formalitas.

Jika implementation membuat dokumentasi tidak akurat:
- update dokumentasi pada task yang sama;
- update `PROJECT_STATUS.md`;
- update relevant progress file;
- buat ADR jika keputusan arsitektur baru;
- jangan meninggalkan dua aturan yang saling bertentangan.

Jika current code berbeda dari target documentation, dokumentasikan discrepancy terlebih dahulu.

---

# FINAL OPERATING PRINCIPLE

> **Inspect first. Audit before implementation. Verify against code. Protect money and credentials. Change the smallest safe surface. Test. Document. Then report.**

*Instruksi ini menggabungkan aturan asli Profitku dengan AI engineering/documentation protocol. Boundary Profitku tetap menjadi authority untuk repo ini; MSC tetap domain terpisah.*
