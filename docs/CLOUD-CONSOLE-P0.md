# P0 — Eksekusi Cloud Console (checklist implementasi)

> Lampiran eksekutif dari `docs/CLOUD-CONSOLE.md`. Keputusan: `docs/DECISIONS.md` (2026-08-06, Opsi C).
> Repo terlibat: **MSC Studio** (`D:\GitHub\MSC-Studio-GD-Project-202604101344`) dan **profitku-cloud** (baru).

## A. MSC Studio → cost-only (margin 0, semua margin di Profitku)

Prinsip: MSC = mesin generate (integrasi SnapGen, job queue, webhook, refund).
**Jangan ubah** mekanisme job/webhook/KV. Yang diubah hanya **kebijakan harga**:

| File (MSC Studio) | Perubahan |
|---|---|
| `functions/api/v1/pricing.ts` | `DEFAULT_V1_MARGIN_CREDITS = 0`; update komentar header (MSC = cost-only; Profitku terapkan ×1.5). Jaga struktur `charge = snapgenRefCost + margin` → dengan margin 0 = cost passthrough. |
| `docs/DECISIONS.md` (MSC) | Tambah keputusan 2026-08-06: MSC cost-only, margin di Profitku (Opsi C). |
| `docs/SNAPGEN_GPT_IMAGE_2_PRICING.md` | Catat bahwa harga yang dilaporkan = COGS; markup 1.5× dilakukan konsumen (Profitku). |
| `functions/api/v1/pricing.ts` (route) | Pastikan `GET /api/v1/pricing` mengembalikan `snapgenRefCostCredits` (cost) secara eksplisit — middleware Profitku membaca ini. |
| `functions/api/v1/account.ts` | Balance tetap internal MSC (opsional); tidak dipakai Profitku untuk menagih merchant. |

Verifikasi: `npx tsc --noEmit` (atau lint repo), smoke `GET /api/v1/pricing` → margin 0.

## B. Scaffold monorepo `profitku-cloud` (baru)

```
profitku-cloud/
  apps/admin/   # copy dari kasirgratisan/admin
  apps/ai/
  apps/report/
  apps/sales/
  api/          # Worker Hono middleware
  packages/shared/
  supabase/     # migrasi credit + report RPC (namespace terpisah: 20260806*)
  docs/
```

- Buat repo GitHub (mis. `gudangdigital5758/profitku-cloud`, private dulu) + CI/CD Pages ×4 + Worker.
- SPA skeleton: Vite + React + Tailwind + Supabase auth (Google) per-subdomain.
- Worker skeleton endpoint awal: `GET /health`, `GET /api/v1/pricing?client=profitku` (proxy ke MSC cost-only, terapkan ×1.5 + tampilkan Rp), `GET /api/v1/account` (saldo credit), `POST /api/v1/topup/checkout` (Midtrans), webhook top-up + AI.

## C. Pindah admin (dari kasirgratisan/admin)

1. `git mv`-analog: salin `admin/` → `apps/admin/` (repo baru), commit pertama.
2. Sesuaikan env: `VITE_API_URL` → worker middleware (atau tetap api.profitku.my.id utk `/admin/api/*` sementara).
3. Tambah halaman **Kelola Credit** (daftar akun, riwayat `credit_transactions`, top-up manual/refund/adjust) — P1, tapi siapkan route menu di P0.
4. Deploy: Pages `profitku-admin` → `dashboard.profitku.my.id` (domain TETAP), update `ADMIN_ORIGIN`, Google OAuth JS origin.
5. Matikan deploy admin lama setelah dipastikan jalan.

## D. Verifikasi P0

- [ ] MSC `GET /api/v1/pricing` → `marginCredits: 0`, `snapgenRefCostCredits` benar.
- [ ] `profitku-cloud` 4 SPA + worker bisa `npm run dev` & build.
- [ ] `dashboard.profitku.my.id` menampilkan admin versi baru (dari repo baru).
- [ ] `api.profitku.my.id` (POS) tidak berubah behavior.
- [ ] Copy POS tidak lagi mengklaim `dashboard.profitku.my.id` untuk merchant (sudah dikerjakan di repo kasirgratisan).
