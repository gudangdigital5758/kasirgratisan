# Admin go-live — dashboard.profitku.my.id

Ops console terpisah dari POS. Kode: folder `admin/`. API: `/admin/api/*`.

---

## Checklist

### A. Worker (sudah sering terpasang)

- [x] Secret `ADMIN_EMAILS` (email staff Google)
- [ ] Secret `ADMIN_ORIGIN` = `https://dashboard.profitku.my.id` (wajib match origin browser)
- [x] Deploy API terbaru (`npm run api:deploy`)
- [ ] Migrasi SQL `20260724000000_admin_ops.sql` di Supabase production

```bash
cd workers/api
npx wrangler secret put ADMIN_ORIGIN
# paste: https://dashboard.profitku.my.id
```

### B. Google OAuth

Di Google Cloud Console → OAuth **Web** client (sama yang dipakai POS):

**Authorized JavaScript origins** tambah:

- `https://dashboard.profitku.my.id`
- `http://localhost:5174` (dev)

### C. Build & deploy Pages

Dari root (membaca root `.env` → `admin/.env.production`):

```bash
npm run admin:deploy
```

Atau:

```bash
npm run admin:build:prod
cd admin
npx wrangler pages deploy dist --project-name=profitku-admin
```

**Status (2026-07-24):** project `profitku-admin` sudah dibuat & deploy.

- Preview / production Pages: `https://profitku-admin.pages.dev`
- Custom domain: Cloudflare Dashboard → **Workers & Pages** → **profitku-admin** → **Custom domains** → add `dashboard.profitku.my.id`  
  (DNS zone `profitku.my.id` harus di akun Cloudflare yang sama)

**Google OAuth** — Authorized JavaScript origins wajib include origin yang dipakai browser:

- `https://dashboard.profitku.my.id`
- `https://profitku-admin.pages.dev` (sementara sebelum custom domain)

### D. Smoke

1. Buka `https://dashboard.profitku.my.id`
2. Login Google (email harus di `ADMIN_EMAILS` atau `admin_users`)
3. Overview KPI load
4. Members list
5. Events poll
6. 403 = email belum di allowlist

### E. Keamanan

- Jangan expose service role ke admin SPA
- Hanya staff di `ADMIN_EMAILS` / `admin_users`
- Opsional: Cloudflare Access di depan domain dashboard

---

## Perintah cepat

```bash
# set origin admin (production)
cd workers/api && npx wrangler secret put ADMIN_ORIGIN

# deploy admin
cd ../.. && npm run admin:deploy

# health API
curl https://api.profitku.my.id/health
```
