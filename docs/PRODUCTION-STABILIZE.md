# Profitku — Stabilisasi production (checklist)

Fase **stabilisasi + deploy**, bukan fitur baru.  
Jalankan berurutan; centang manual di sini atau di issue.

**Terakhir dicek otomatis (API):** `https://api.profitku.my.id/health`  
Harapan minimum: `ok`, `supabase`, `r2`, `onesignal` = true (Resend/Fonnte opsional).

---

## 0. Kode di Git

- [ ] Branch `main` bersih / PR sudah merge  
- [ ] Tidak ada secret di commit (`.env`, `.dev.vars`, REST keys)  
- [ ] Fitur terkini yang relevan sudah di `main`: cloud hub, shift, admin, OneSignal  

```bash
git status
git log -5 --oneline
```

---

## 1. Supabase — migrasi

Di **SQL Editor** (project production), pastikan sudah dijalankan:

| File | Isi |
|------|-----|
| `20260723000000_init_profitku.sql` | Schema cloud inti |
| `supabase/seed.sql` | Plan `cloud_monthly` 25rb |
| `20260724000000_admin_ops.sql` | admin_users, audit, events, settings |
| `20260724120000_notification_push_channel.sql` | channel `push` di notification_log |

Verifikasi cepat:

```sql
select id, name, price_idr from plans where id = 'cloud_monthly';
select to_regclass('public.admin_users');
select to_regclass('public.platform_events');
-- enum push:
select e.enumlabel from pg_enum e
join pg_type t on e.enumtypid = t.oid
where t.typname = 'notification_channel';
```

---

## 2. Cloudflare Worker — secrets & deploy

### Secrets (nama saja; isi sudah di dashboard / wrangler)

Wajib:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Opsional tapi disarankan:

- `RESEND_API_KEY`, `RESEND_FROM`
- `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`
- `ADMIN_EMAILS`, `ADMIN_ORIGIN` (`https://dashboard.profitku.my.id`)
- `WEBHOOK_SECRET`, `PAYMENT_PROVIDER` (`mock` sampai gateway live)
- `FONNTE_TOKEN` (WA)

```bash
cd workers/api
npx wrangler secret list
```

### Deploy

```bash
# dari root
npm run api:deploy
```

### Health

```bash
curl https://api.profitku.my.id/health
# npm run cloud:check -- --url https://api.profitku.my.id
```

| Field | Target |
|-------|--------|
| `ok` | true |
| `supabase` | true |
| `r2` | true |
| `onesignal` | true jika push diaktifkan |
| `resend` | true jika email diaktifkan |
| `fonnte` | true jika WA diaktifkan |

---

## 3. App web (Pages / PWA)

Build dengan **env production** (CI / Pages env vars), **bukan** localhost API:

```env
VITE_AUTH_API_URL=https://api.profitku.my.id
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_CLIENT_ID=...
VITE_ONESIGNAL_APP_ID=f4c3717b-0f15-4d50-92aa-29a88f4f66ad
```

```bash
npm run build
# deploy dist/ ke Cloudflare Pages → profitku.my.id
```

Google OAuth **Authorized JavaScript origins** harus include `https://profitku.my.id`.

---

## 4. Admin SPA (ops) — go-live

Panduan: [ADMIN-GO-LIVE.md](./ADMIN-GO-LIVE.md)

```bash
# root: generate admin/.env.production + build + deploy Pages
npm run admin:deploy
```

- Project: **profitku-admin** → `https://profitku-admin.pages.dev`
- Custom domain: tambah `dashboard.profitku.my.id` di Cloudflare Pages UI
- Worker secrets: `ADMIN_ORIGIN=https://dashboard.profitku.my.id`, `ADMIN_EMAILS=…`
- Google OAuth JS origins: + `https://dashboard.profitku.my.id` (+ pages.dev jika tes)

---

## 5. Smoke test browser (wajib)

### POS / Cloud

- [ ] Buka `https://profitku.my.id` (airplane mode: kasir tetap bisa)
- [ ] Login Google Cloud
- [ ] Settings → Profitku Cloud → status / backup
- [ ] Path lama `/settings/cloud-backup` redirect ke `/settings/cloud`
- [ ] Mock/real checkout (jika mock: verifikasi aktif 30 hari)
- [ ] Upload backup cloud (R2)

### OneSignal

- [ ] Setelah login Cloud, modal/izin push (atau Settings → Notifikasi push)
- [ ] OneSignal Audience ada subscriber + External ID = user uuid
- [ ] (Opsional) mock: `POST /api/dev/notify-test` body `{"userId":"..."}` hanya jika `PAYMENT_PROVIDER=mock`

### Shift / margin (regresi cepat)

- [ ] Products: margin % + saran harga
- [ ] `/shifts` buka/tutup
- [ ] Dashboard: laba bersih hari ini

### Admin

- [ ] Login Google di dashboard
- [ ] Overview + Members load (403 = email belum di ADMIN_EMAILS)
- [ ] Extend sub (opsional) → cek audit

---

## 6. Yang sengaja ditunda

- Midtrans/Xendit production (masih mock OK)
- Fonnte jika belum ada token
- Play Store listing
- Sync multi-device penuh

---

## 7. Rollback cepat

- Worker: deploy versi sebelumnya dari Cloudflare dashboard / re-deploy commit lama  
- Pages: rollback deployment  
- Secret salah: `wrangler secret put` ulang  

---

## Perintah ringkas

```bash
# cek local + prod API
npm run cloud:check
npm run cloud:check -- --url https://api.profitku.my.id

# deploy API
npm run api:deploy

# build app
npm run build
```
