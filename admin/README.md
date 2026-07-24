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

## Deploy (go-live)

### Otomatis dari root repo

```bash
# 1) Pastikan root .env punya VITE_SUPABASE_* + VITE_GOOGLE_CLIENT_ID
# 2) Worker secrets: ADMIN_EMAILS, ADMIN_ORIGIN=https://dashboard.profitku.my.id
# 3) Build + deploy Cloudflare Pages project "profitku-admin"
npm run admin:deploy
```

Setelah deploy pertama, di Cloudflare Dashboard:

1. **Workers & Pages** → project `profitku-admin`
2. **Custom domains** → `dashboard.profitku.my.id`
3. Google Cloud OAuth → Authorized JavaScript origins tambah:
   - `https://dashboard.profitku.my.id`
4. Supabase Auth → URL Configuration / redirect jika dipakai

### Manual

```bash
cd admin
# buat .env.production (VITE_API_URL=https://api.profitku.my.id + supabase + google)
npm run build:prod
npx wrangler pages deploy dist --project-name=profitku-admin
```

SPA fallback: `public/_redirects` → `/* /index.html 200`

### CORS / API

Worker secrets:

```bash
cd workers/api
npx wrangler secret put ADMIN_ORIGIN
# https://dashboard.profitku.my.id

npx wrangler secret put ADMIN_EMAILS
# email@gmail.com
```

CORS di Worker juga mengizinkan `ADMIN_ORIGIN` + localhost:5174.

## Boundary

- Secrets (Fonnte, Resend, service role) **tidak** di UI
- Jangan embed admin ke POS PWA
- Impersonation user belum ada (sengaja)
