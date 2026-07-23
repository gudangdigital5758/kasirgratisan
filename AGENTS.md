# Profitku Agent Instructions

Instruksi **khusus repo Profitku** (kasirgratisan). Melengkapi instruksi user-level (Grok / Codex / Cursor).  
Diadaptasi dari pola proses MSC Studio — **bukan** salinan path/stack MSC.

## New Session Bootstrap

Di awal chat baru untuk repo ini, sebelum coding / patch / operasi tulis:

1. Baca `README.md`.
2. Baca `docs/profitku-cloud.md` (cloud, deploy, auth, R2, langganan).
3. Baca `docs/ARCHITECTURE.md` (batas offline vs cloud).
4. Baca `docs/DECISIONS.md` (keputusan yang tidak boleh dilanggar diam-diam).
5. Baca `src/lib/brand.ts` (nama, domain, paket 25rb, Play flag).
6. Jika kerja API/cloud: skim `workers/api/README.md` dan `workers/api/src/index.ts` (entry).
7. Jalankan `git status --short` (dan ringkas branch).
8. Jika ada `PROJECT_STATE.md` lokal: anggap **continuity saja**, bisa usang — bukan source of truth.
9. Ringkas: state proyek, state Git, risiko relevan, next step yang disarankan.
10. **Jangan mengubah file** sampai user memberi **kode approve** atau perintah implementasi yang jelas (lihat **Approval codes** di bawah).

Pertanyaan murni / audit read-only / laporan **tidak** butuh kode approve.

## Approval codes

Kode berikut setara **izin eksekusi** (edit file, implementasi, patch). Cukup salah satu, berdiri sendiri atau di pesan yang sama dengan instruksi:

| Kode | Arti |
|------|------|
| **`1526`** | Approve / izinkan eksekusi |
| **`5647`** | Approve / izinkan eksekusi |

Setara teks (tetap diterima): `APPROVE`, `EKSEKUSI`, `EXECUTE`, `APPLY PATCH`.

Juga dihitung approve jika user **jelas** meminta implementasi langsung, misalnya: “lanjutkan”, “implementasikan X”, “buat file Y”, “tambahkan aturan Z” — tanpa harus mengulang kode, selama konteksnya permintaan kerja (bukan sekadar “bagaimana caranya?”).

**Bukan approve:** pertanyaan, audit, “apa langkah selanjutnya?”, “jelaskan saja”, penolakan, atau angka lain selain `1526` / `5647`.

## Source Of Truth

- Isi repository yang ter-track adalah source of truth.
- `PROJECT_STATE.md` (jika ada) hanya continuity lokal agent; **jangan di-commit** (lihat `.gitignore`).
- Pengetahuan stabil ada di:
  - `README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/profitku-cloud.md`
  - `docs/DECISIONS.md`
  - `docs/android-google-signin.md`
  - `workers/api/README.md`
  - `supabase/migrations/*` + `supabase/seed.sql`
  - `src/lib/brand.ts`

## Architecture Boundaries

| Boundary | Aturan |
|----------|--------|
| **POS offline** | `src/` — React + Vite + Dexie. Kasir, stok, laporan, multi-user PIN harus jalan **tanpa** cloud. |
| **Cloud API** | `workers/api` — Hono di Cloudflare Workers. Secrets (service role, Fonnte, Resend, payment) **hanya** di Worker env/secrets. |
| **Cloud DB** | `supabase/` — migrasi + seed; RLS dihormati; service role hanya di Worker. |
| **Client cloud auth** | Supabase Auth (access/refresh). Production: jangan andalkan Google ID JWT long-lived di `localStorage`. |
| **Brand / domain** | `profitku.my.id`, `api.profitku.my.id`, appId `com.profitku.app`. |
| **Paket** | Satu plan: `cloud_monthly` / **Rp 25.000**/bulan (`BRAND.cloudPriceIdr`). Jangan reintro multi-tier tanpa keputusan di `DECISIONS.md`. |
| **Play Store** | `BRAND.playStoreEnabled === false` — listing ditunda; jangan hidupkan alert/billing Play tanpa update flag + decision. |
| **Data lokal user** | Nama IndexedDB `kasirgratisan-db` dan key session legacy: **jangan diganti** sembarangan (bisa menghapus data toko user). |
| **i18n** | String UI lewat `src/i18n/locales/{id,en,ms}/` — jangan hardcode teks user-facing baru tanpa terjemahan. |

Frontend **tidak** boleh memuat `SUPABASE_SERVICE_ROLE_KEY`, `FONNTE_TOKEN`, `RESEND_API_KEY`, atau kunci payment.

## Product Principles

1. **Kasir gratis offline dulu** — fitur cloud tidak boleh memblokir jual-beli tanpa internet.
2. **Cloud opsional berbayar** — backup/sync/notif; jujur di UI (satu harga 25rb).
3. **Server tidak percaya harga/nominal sensitif dari client** untuk billing cloud; status langganan dari backend.
4. **Atomicity** — checkout/stok: utamakan transaksi Dexie multi-table; hindari partial write.
5. **Jangan overpromise multi-device** sampai sync pull/conflict siap.

## Validation Expectations

Setelah perubahan kode (bukan murni Q&A):

| Area | Perintah |
|------|----------|
| Lint app | `npm run lint` |
| Unit test | `npm test` |
| Build web | `npm run build` |
| Worker types | `cd workers/api && npx tsc --noEmit` (atau `npm run typecheck` di folder itu) |
| Diff hygiene | `git diff --check` jika tersedia |

Jika suatu check tidak bisa dijalankan, laporkan alasan dengan jelas.

Dokumentasi-only: `git diff --check` biasanya cukup.

## Closing: Summary + Git Commit (wajib)

Di **akhir setiap turn** yang menyelesaikan implementasi, fix, refactor, docs, atau perubahan file ter-track lainnya (bukan pure Q&A / audit read-only tanpa edit), **selalu** berikan dua blok siap tempel:

### 1. Ringkasan kerja (untuk chat / PR)

Singkat, bahasa jelas: apa yang diubah, kenapa, dampak user/dev. Bullet 3–8 poin jika perlu.

### 2. Git commit — Summary + Description (wajib lengkap)

Format agar user bisa copy ke kotak commit (GitHub Desktop, VS Code, `git commit`):

```
### Commit summary (subject)
<satu baris imperatif, ≤72 karakter, conventional commit jika cocok>

### Commit description (body)
<2–6 baris: apa + mengapa; file/area utama; breaking change jika ada>
```

Atau satu fenced block multi-baris (subject, baris kosong, body) yang siap di-paste utuh:

```
feat(scope): ringkasan pendek

- Poin perubahan 1
- Poin perubahan 2
- Why / follow-up singkat
```

Aturan:

1. **Summary (subject)** — selalu ada; imperatif; `feat|fix|docs|refactor|chore|test(scope): …` jika cocok.
2. **Description (body)** — **selalu ada** setelah implementasi/perubahan berarti (jangan hanya subject kosong body). Minimal 2 kalimat/bullet: apa yang berubah + mengapa. Untuk typo/satu baris trivial, body 1–2 bullet tetap lebih baik daripada kosong.
3. Berdasarkan **diff aktual** di sesi, bukan template generik.
4. **Jangan** `git commit` / `git push` / force-push / deploy production kecuali user meminta eksplisit.
5. Tree bersih / hanya file ignored → katakan tidak perlu commit message, cukup ringkas “tidak ada perubahan ter-track”.
6. Blok code fence agar mudah di-copy-paste.
7. Jika user minta “siap commit” / “pesan commit saja”, prioritaskan blok summary + description di atas narasi panjang.

## Safety

- Jangan commit `.env`, keystore, `*.jks`, service role, atau secret.
- Jangan `rm -rf` massal / reset hard tanpa konfirmasi.
- Jangan serang sistem eksternal; exploit/malware out of scope.
- Destructive DB (drop production) — minta konfirmasi eksplisit.

## Out Of Scope (jangan “bawa dari MSC Studio”)

Jangan mengasumsikan atau men-scaffold: Leonardo/SnapGen/Tele Queue, `functions/api/*` Pages shape MSC, `telegram-automator/`, atau portal B2B member catalog — itu domain repo lain.

---

*Template proses diinspirasi MSC Studio `AGENTS.md`; konten boundary disesuaikan 100% untuk Profitku.*
