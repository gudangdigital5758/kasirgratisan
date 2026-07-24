# Profitku Admin

Internal ops console (bukan app kasir POS).

- **Domain target:** `https://dashboard.profitku.my.id`
- **API:** `https://api.profitku.my.id/admin/api/*` (Hono Worker)
- **Auth:** Google → Supabase Auth (same project as POS). Akses staff via:
  1. Worker secret `ADMIN_EMAILS=you@gmail.com,ops@…`, atau
  2. Baris `admin_users` di Supabase (setelah migrasi)

## Setup lokal

```bash
# 1. Migrasi SQL
# supabase/migrations/20260724000000_admin_ops.sql → SQL Editor

# 2. Worker secrets
cd workers/api
npx wrangler secret put ADMIN_EMAILS
# optional: ADMIN_ORIGIN=http://localhost:5174

# 3. Admin SPA
cd admin
cp .env.example .env
# isi VITE_API_URL, VITE_SUPABASE_*, VITE_GOOGLE_CLIENT_ID
npm install
npm run dev
# → http://localhost:5174
```

Jalankan API lokal: dari root `npm run api:dev` (port 8787).

## Fitur v1

| Halaman | Isi |
|---------|-----|
| Overview | KPI members, sub aktif, MRR≈, backup 24h |
| Members | Cari + detail + **extend langganan** (audit) |
| Payments | 50 payment terakhir |
| Events | Poll platform_events + notification_log + audit |
| Platform | Feature flags + health (bukan secrets) |

## Deploy

- Build: `npm run build` di folder `admin/` → output `admin/dist`
- Host di Cloudflare Pages custom domain `dashboard.profitku.my.id`
- CORS: Worker sudah include `ADMIN_ORIGIN` / localhost:5174

## Boundary

- Secrets (Fonnte, Resend, service role) **tidak** di UI
- Jangan embed admin ke POS PWA
- Impersonation user belum ada (sengaja)
