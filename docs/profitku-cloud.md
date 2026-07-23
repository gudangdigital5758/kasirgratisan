# Profitku Cloud — arsitektur & deploy

**Produk:** Profitku (`profitku.my.id`)  
**Stack:** Git · Cloudflare · Supabase · Resend · Fonnte · langganan bulanan

## Prinsip

1. **Kasir offline tetap gratis** — IndexedDB/Dexie di perangkat.
2. **Cloud berbayar** — backup, sync, multi-toko, notifikasi.
3. **Secret hanya di Worker** — Fonnte, Resend, payment, Supabase service role.

## Domain

| Host | Layanan |
|------|---------|
| `profitku.my.id` | Cloudflare Pages (app Vite PWA) |
| `api.profitku.my.id` | Cloudflare Worker (`workers/api`) |
| `dashboard.profitku.my.id` | (fase berikut) admin/dashboard |
| `market.profitku.my.id` | (fase berikut) katalog toko publik |

## Struktur repo

```
supabase/migrations/   # schema Postgres + RLS
supabase/seed.sql      # paket langganan
workers/api/           # Hono on Cloudflare Workers
src/lib/brand.ts       # identitas produk
src/lib/cloud-api.ts   # client → api.profitku.my.id
```

## Setup Supabase

1. Buat project Supabase (region Singapore disarankan).
2. SQL Editor: jalankan `supabase/migrations/20260723000000_init_profitku.sql`.
3. Jalankan `supabase/seed.sql`.
4. Auth → Providers → Google (Client ID/Secret OAuth).
5. Catat: Project URL, `anon` key, `service_role` key.

## Setup Worker

```bash
cd workers/api
npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FONNTE_TOKEN
# opsional payment:
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

Di Cloudflare dashboard: route `api.profitku.my.id/*` → worker `profitku-api`.

Local:

```bash
npm run api:dev
# → http://127.0.0.1:8787/health
```

## Setup app web

```bash
cp .env.example .env
# VITE_AUTH_API_URL=http://127.0.0.1:8787   # local
# VITE_AUTH_API_URL=https://api.profitku.my.id  # prod
# VITE_GOOGLE_CLIENT_ID=...
npm run dev
```

Deploy Pages: build `npm run build`, output `dist/`, custom domain `profitku.my.id`.

## Paket langganan (single plan)

| ID | Nama | Harga/bln | Termasuk |
|----|------|-----------|----------|
| `cloud_monthly` | **Profitku Cloud** | **Rp 25.000** | Backup cloud s/d 2 GB, auto-backup, sync 1 toko, hide watermark |

Tidak ada multi-tier. Seed: `supabase/seed.sql` + fallback Worker `SEED_PLANS`.

Checkout saat ini: **mode mock** (verifikasi langsung mengaktifkan 30 hari).  
Integrasi Midtrans/Xendit: lengkapi `POST /api/payments/checkout` + `POST /webhook/payment`.

## Google Play

**Ditunda.** Distribusi utama: PWA di `profitku.my.id`.  
Flag: `BRAND.playStoreEnabled = false` di `src/lib/brand.ts` — alert Play & billing in-app dimatikan.  
Aktifkan kembali saat siap listing (`com.profitku.app`).

## Auth flow (fase 3)

```
User Google Login (GIS / native)
        ↓ Google ID token
supabase.auth.signInWithIdToken({ provider: 'google', token })
        ↓ (fallback Worker POST /api/auth/google)
Supabase session (access + refresh, storageKey profitku_supabase_auth)
        ↓ Bearer access_token
Cloudflare Worker API (validasi via /auth/v1/user)
```

Tanpa `VITE_SUPABASE_*`, app jatuh ke **legacy** (Google JWT di `localStorage`) — hanya untuk dev.

## Resend & Fonnte

- **Resend:** invoice, welcome, dunning H-3.
- **Fonnte:** WA bayar sukses / reminder (token hanya di Worker).
- Tes mock: `POST /api/dev/notify-test` body `{ "email": "...", "phone": "08..." }` (hanya `PAYMENT_PROVIDER=mock`).

## Roadmap fase

| Fase | Isi | Status |
|------|-----|--------|
| M1 | Schema + plans + profile + checkout mock | ✅ |
| **1** | **Backup R2** upload/list/download/delete + kuota | ✅ |
| **2** | **Resend invoice + Fonnte** aktivasi + dunning H-3/H-1 (cron) | ✅ |
| **3** | **Supabase Auth** (Google ID token → session, auto-refresh) | ✅ |
| M3 | Sync push penuh | stub log |
| M4 | Pull + conflict | belum |
| M5 | Midtrans/Xendit production | skeleton |

### Setup Supabase Auth + Google

1. Supabase Dashboard → Authentication → Providers → **Google** ON  
2. Client ID / Secret dari Google Cloud Console (OAuth Web)  
3. Authorized redirect: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`  
4. App `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`  
5. Worker secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### Setup R2

```bash
# Dashboard CF → R2 → Create bucket `profitku-backups`
# Uncomment di workers/api/wrangler.toml:
# [[r2_buckets]]
# binding = "BACKUP_BUCKET"
# bucket_name = "profitku-backups"
```

### Setup Resend / Fonnte

```bash
cd workers/api
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM   # optional, default Profitku <noreply@profitku.my.id>
npx wrangler secret put FONNTE_TOKEN
npx wrangler secret put WEBHOOK_SECRET  # cron dunning + payment webhook
```

Cron dunning: `0 1 * * *` UTC (lihat `wrangler.toml` triggers).  
Manual: `POST /api/cron/dunning` header `x-cron-secret`.

## Android / Play Store

- `applicationId` disiapkan: `com.profitku.app` (Capacitor)
- **Listing Play Store ditunda** — fokus PWA + web payment
- Google Sign-In native: `docs/android-google-signin.md` (untuk build APK internal/sideload)
