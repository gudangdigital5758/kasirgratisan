# GIT-WORKFLOW — Kebijakan Branch & Deploy Profitku

> Berlaku untuk kedua repo: `kasirgratisan` (POS, admin, worker) & `profitku-cloud`
> (portal affiliate, cloud dashboard). Ringkas — detail CI di `docs/IMPLEMENTATION-PLAN-ADMIN-SYNC.md`.

## Prinsip

- **`main` = jalur rilis.** Push ke main (atau merge PR ke main) = build + test + deploy + smoke.
- **Semua branch lain = area kerja.** Push branch apa pun hanya menjalankan check (lint/test/build),
  **tidak pernah deploy** (job `deploy` di workflow di-gate `if: github.ref == 'refs/heads/main'`).
- **Commit docs-only tidak memicu pipeline** (`paths-ignore: docs/**`, `*.md`) — hemat menit CI.

## Kebijakan aktor

| Aktor | Boleh | Tidak boleh |
|---|---|---|
| Owner/manusia | Push ke `main` langsung untuk kerja kecil (kebiasaan saat ini tetap valid) | — |
| Agent (Hermes dkk) | Push ke branch (`dev`, `feat/*`), buka PR ke main | Push langsung ke main tanpa review |
| CI | Check di semua branch; deploy + smoke hanya di main | — |

## Alur kerja agent (disarankan)

```text
agent:  git checkout -b feat/xyz
        ... kerja & commit (push ke branch — aman, tidak deploy) ...
        PR ke main  → CI check hijau  → merge  → deploy + smoke
```

## Branch protection (manual, sekali di GitHub)

GitHub → repo → **Settings → Branches → Add rule** untuk `main`:
1. **Require status checks to pass before merging** (pilih `CI / Web (lint + test + build)` dan `CI / API Worker (typecheck)`).
2. (Opsional) **Require a pull request before merging** — kalau mau memaksa semua perubahan lewat PR.
3. (Opsional) **Restrict who can push to matching branches** — hanya owner.

Catatan: aturan ini tidak menghalangi owner push langsung; hanya mengunci agent/kolaborator.

## Kuota GitHub Actions (konteks)

- Free: 2000 menit/bln (repo privat, Linux 1×). Satu push penuh ≈ 6–10 menit.
- Dengan pola di atas: kerja agent di branch tetap memakai menit (check), tapi tanpa deploy;
  docs-only = 0 menit.
- Kalau volume agent tinggi nanti: opsi (a) self-hosted runner di VPS → 0 menit,
  (b) deploy langsung dari VPS via `wrangler` → Actions hanya check. Tidak perlu diputuskan hari ini.

## Referensi

- Workflow: `.github/workflows/ci.yml` (kedua repo).
- Rencana fase & monitoring: `docs/IMPLEMENTATION-PLAN-ADMIN-SYNC.md`.
