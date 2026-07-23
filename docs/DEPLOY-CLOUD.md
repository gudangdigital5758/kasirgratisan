# Profitku — Setup & Deploy Cloud

Panduan operasional: **Supabase + R2 + secrets Worker + Pages**.  
Arsitektur: [profitku-cloud.md](./profitku-cloud.md).

**Akun Cloudflare terdeteksi (dev machine):** Wrangler login OK.  
**Worker name:** `profitku-api`  
**R2 bucket:** `profitku-backups`  
**Domain target:** `profitku.my.id` · `api.profitku.my.id`

---

## Checklist cepat

- [ ] A. Supabase project + migration + seed + Google Auth  
- [ ] B. R2 bucket `profitku-backups` + binding di `wrangler.toml`  
- [ ] C. Worker secrets diisi  
- [ ] D. `wrangler deploy` Worker + custom domain API  
- [ ] E. App `.env` production + build + Cloudflare Pages  
- [ ] F. Smoke test: `/health` → login Google → mock bayar → backup  

Skrip bantu: `npm run cloud:check` (cek env lokal + health API).

---

## A. Supabase

### 1. Buat project

1. Buka [https://supabase.com/dashboard](https://supabase.com/dashboard)  
2. **New project** — region **Singapore** (ap-southeast-1) disarankan  
3. Simpan DB password di password manager  

### 2. Jalankan SQL

Di **SQL Editor**, jalankan berurutan:

1. Seluruh isi `supabase/migrations/20260723000000_init_profitku.sql`  
2. Seluruh isi `supabase/seed.sql` (paket `cloud_monthly` Rp 25.000)

Verifikasi:

```sql
select id, name, price_idr, is_active from plans;
-- harus ada cloud_monthly / Profitku Cloud / 25000
```

### 3. Google Auth

1. **Authentication → Providers → Google → Enable**  
2. Google Cloud Console → OAuth **Web** client:  
   - Authorized JS origins: `http://localhost:8080`, `https://profitku.my.id`  
   - Redirect URI Supabase:  
     `https://<PROJECT_REF>.supabase.co/auth/v1/callback`  
3. Paste Client ID + Client Secret ke Supabase Google provider  
4. Catat dari **Project Settings → API**:  
   - Project URL → `VITE_SUPABASE_URL` / `SUPABASE_URL`  
   - `anon` `public` → `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`  
   - `service_role` → **hanya** `SUPABASE_SERVICE_ROLE_KEY` di Worker (jangan di Vite)

---

## B. Cloudflare R2

### Buat bucket (CLI)

```bash
cd workers/api
npx wrangler r2 bucket create profitku-backups
```

Atau Dashboard → **R2** → Create bucket → name: `profitku-backups` (private).

### Binding

Di `workers/api/wrangler.toml` pastikan ada:

```toml
[[r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "profitku-backups"
```

(Repo sudah dikonfigurasi demikian setelah setup.)

---

## C. Secrets Worker

Dari folder `workers/api`:

```bash
npx wrangler login   # sekali saja

npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
# contoh value: Profitku <noreply@profitku.my.id>

npx wrangler secret put FONNTE_TOKEN
npx wrangler secret put WEBHOOK_SECRET
# random panjang, mis. openssl rand -hex 32

# opsional
npx wrangler secret put PAYMENT_PROVIDER
# value: mock | midtrans | xendit
```

**Lokal** (jangan commit):

```bash
cd workers/api
copy .dev.vars.example .dev.vars
# isi nilai dev
npm run dev
```

Lihat secret yang sudah terpasang (nama saja):

```bash
npx wrangler secret list
```

---

## D. Deploy Worker

```bash
# dari root repo
npm run api:deploy

# atau
cd workers/api
npm run deploy
```

### Domain API

Dashboard Cloudflare → **Workers & Pages** → `profitku-api` → **Settings → Domains & Routes**:

- Custom domain: `api.profitku.my.id`  
  (DNS zone `profitku.my.id` harus di Cloudflare)

### Health

```bash
curl https://api.profitku.my.id/health
# atau workers.dev URL dari output deploy
```

Harapan JSON (setelah secrets + R2):

```json
{
  "ok": true,
  "service": "profitku-api",
  "supabase": true,
  "r2": true,
  "resend": true,
  "fonnte": true
}
```

`false` = secret/binding belum terpasang.

---

## E. Deploy app (Pages)

### 1. Env build (Pages → Settings → Environment variables)

| Variable | Value production |
|----------|------------------|
| `VITE_AUTH_API_URL` | `https://api.profitku.my.id` |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon key |
| `VITE_GOOGLE_CLIENT_ID` | Web client ID Google |

### 2. Build

```bash
# lokal verifikasi
copy .env.example .env
# isi VITE_* production atau local
npm install
npm run build
```

### 3. Pages project

- Framework preset: Vite  
- Build command: `npm run build`  
- Output: `dist`  
- Custom domain: `profitku.my.id` (+ `www` redirect opsional)

Atau unggah `dist/` manual / Wrangler Pages:

```bash
npx wrangler pages deploy dist --project-name profitku
```

---

## F. Smoke test

1. Buka `https://profitku.my.id` (atau localhost + API prod/local)  
2. Login Google di **Profitku Cloud**  
3. Langganan mock (verify) → status aktif  
4. **File Backup Cloud** → Backup sekarang → list muncul  
5. Restore (perangkat uji, bukan toko production penting)  
6. (Opsional) cek email Resend + WA Fonnte setelah verify  

Cron dunning: `0 1 * * *` UTC di Worker — pastikan account Workers Paid / cron enabled jika diperlukan plan CF.

---

## Perintah root (npm)

| Script | Fungsi |
|--------|--------|
| `npm run api:dev` | Worker lokal :8787 |
| `npm run api:deploy` | Deploy Worker production |
| `npm run cloud:check` | Cek `.env` + GET `/health` |
| `npm run cloud:secrets-help` | Cetak daftar `wrangler secret put` |

---

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| `supabase: false` di health | Secret `SUPABASE_*` di Worker |
| `r2: false` | Binding `BACKUP_BUCKET` + bucket name |
| Upload 503 R2 | Deploy ulang setelah binding; bucket ada |
| Login Google gagal | Supabase Google provider + Client ID sama dengan `VITE_GOOGLE_CLIENT_ID` |
| CORS | `APP_ORIGIN` = `https://profitku.my.id` (wrangler vars) |
| 401 API | Session Supabase; Bearer access token |

---

## Keamanan

- **Jangan** commit `.env`, `.dev.vars`, service role.  
- Service role **hanya** Worker secrets.  
- Rotasi `WEBHOOK_SECRET` jika bocor.  
- Domain production HTTPS only.
