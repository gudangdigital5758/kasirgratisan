# `@profitku/api` — Cloudflare Worker

API edge Profitku: plans, profile/entitlements, checkout langganan, stores, webhooks, notify (Resend/Fonnte).

## Commands

```bash
npm install
npm run dev      # wrangler dev → :8787
npm run deploy
```

## Endpoints utama

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | no |
| GET | `/api/plans` | no |
| GET | `/api/user/profile` | Bearer |
| POST | `/api/payments/checkout` | Bearer |
| POST | `/api/payments/verify/:id` | Bearer |
| GET | `/api/payments/history` | Bearer |
| GET/POST | `/api/stores` | Bearer |
| POST | `/api/stores/:id/sync` | Bearer |
| POST | `/webhook/payment` | secret |
| POST | `/webhook/issue-report` | no |

Lihat `docs/profitku-cloud.md` untuk secret & domain.

Agent / kontributor: ikuti `AGENTS.md` di root repo (boundary cloud vs POS offline).
