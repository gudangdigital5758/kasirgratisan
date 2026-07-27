# Deployment Analysis - Profitku Cloud Infrastructure

**Analisis:** 2026-07-27  
**Context:** Fix "Belum login" di admin Settings Page sudah dikerjakan, tapi deployment belum update

---

## 🎯 Current State (dari Cloudflare Dashboard)

| Project | Last Deploy | Git Connection | Status |
|---------|-------------|----------------|--------|
| **profitku** (PWA) | 2m ago | ✅ Connected (`gudangdigital5758/kasirgratisan`) | ✅ Auto-deploy aktif |
| **profitku-admin** | 2h ago | ❌ **No Git connection** | ⚠️ Manual deploy only |
| **profitku-api** | 5h ago | N/A (Worker) | ✅ OK (manual via `wrangler deploy`) |

---

## 🔍 Root Cause Analysis

### Masalah Utama

**`profitku-admin` TIDAK ter-configure untuk auto-deploy dari Git.**

Artinya:
1. ✅ Code fix untuk "Belum login" sudah di-commit ke repo
2. ✅ Main app `profitku` auto-deploy dan sudah update
3. ❌ **Admin dashboard BELUM deploy** → masih pakai code lama 2 jam lalu
4. ❌ User masih akan kena error "Belum login" di admin sampai deploy manual

### Kenapa Hanya `profitku` yang Auto-Deploy?

Dari Cloudflare Pages, hanya **satu project** yang bisa di-link langsung ke Git repository per branch. Saat ini:
- `profitku` → linked ke `main` branch → auto-deploy on push ✅
- `profitku-admin` → **tidak linked** → butuh deploy manual ❌

---

## 📋 Solusi: 3 Opsi Deployment

### **Opsi 1: Manual Deploy Admin (CEPAT - Recommended untuk sekarang)**

Untuk segera deploy fix yang sudah dikerjakan:

```bash
# Dari root repo
npm run admin:deploy
```

Atau manual:

```bash
cd admin
npm run deploy
# = npm run build:prod && npx wrangler pages deploy dist --project-name=profitku-admin
```

**Proses:**
1. Generate `admin/.env.production` dari root `.env` (via `scripts/admin-env-from-root.mjs`)
2. Build admin SPA dengan Vite (output: `admin/dist/`)
3. Deploy ke Cloudflare Pages via Wrangler CLI

**Waktu:** ~2-3 menit  
**Result:** `profitku-admin` akan update dengan code fix terbaru

---

### **Opsi 2: Configure Git Auto-Deploy untuk Admin (Jangka Panjang)**

Agar admin juga auto-deploy saat push ke GitHub:

#### A. Gunakan Monorepo Build Config

Cloudflare Pages bisa handle monorepo dengan build config per project:

**Dashboard → profitku-admin → Settings → Builds & deployments:**

1. **Connect to Git** → pilih repo `gudangdigital5758/kasirgratisan`
2. **Production branch:** `main`
3. **Build configuration:**
   - Framework preset: `Vite`
   - Build command: `npm run admin:build:prod`
   - Build output directory: `admin/dist`
   - Root directory: `/` (monorepo root)
   - Install command: `npm install`

4. **Environment variables** (production):
   ```
   VITE_API_URL=https://api.profitku.my.id
   VITE_SUPABASE_URL=https://zrlcmoffzwpopuhopkju.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   VITE_GOOGLE_CLIENT_ID=1040830182815-...
   ```

**Cons:** Setiap push ke `main` akan trigger build untuk **profitku** DAN **profitku-admin** → double build, double deploy.

#### B. Separate Branch Strategy

- `main` → auto-deploy `profitku` (PWA)
- `admin-deploy` → auto-deploy `profitku-admin`

Merge `main` ke `admin-deploy` saat perlu deploy admin.

**Cons:** Maintenance overhead untuk manage 2 branches.

---

### **Opsi 3: CI/CD Pipeline (GitHub Actions)**

Buat `.github/workflows/deploy.yml` untuk smart deploy:

```yaml
name: Deploy Profitku Cloud

on:
  push:
    branches: [main]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      app: ${{ steps.filter.outputs.app }}
      admin: ${{ steps.filter.outputs.admin }}
      api: ${{ steps.filter.outputs.api }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v2
        id: filter
        with:
          filters: |
            app:
              - 'src/**'
              - 'public/**'
              - 'index.html'
              - 'vite.config.ts'
              - 'package.json'
            admin:
              - 'admin/**'
            api:
              - 'workers/api/**'

  deploy-app:
    needs: detect-changes
    if: needs.detect-changes.outputs.app == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy dist --project-name=profitku

  deploy-admin:
    needs: detect-changes
    if: needs.detect-changes.outputs.admin == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run admin:build:prod
        env:
          VITE_API_URL: https://api.profitku.my.id
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy admin/dist --project-name=profitku-admin

  deploy-api:
    needs: detect-changes
    if: needs.detect-changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run api:deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

**Keuntungan:**
- Smart detection: hanya deploy yang berubah
- Secrets management via GitHub
- Audit trail di GitHub Actions
- Parallel builds

**Setup Secrets di GitHub:**
- `CLOUDFLARE_API_TOKEN`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_CLIENT_ID`

---

## 🎯 Rekomendasi

### **Immediate Action (Hari Ini)**

```bash
npm run admin:deploy
```

Deploy manual untuk apply fix "Belum login" yang sudah dikerjakan.

### **Long Term (Week 1-2)**

**Gunakan Opsi 3 (CI/CD GitHub Actions)** karena:

1. ✅ **Smart deploy** - hanya build yang berubah
2. ✅ **Atomic** - ketiga project bisa deploy independent
3. ✅ **Audit trail** - history di GitHub Actions
4. ✅ **Secrets management** - tidak perlu commit `.env`
5. ✅ **Scalable** - mudah tambah staging/preview environment
6. ✅ **Rollback** - rerun workflow untuk deploy ulang

---

## 📝 Deploy Commands Reference

| Command | Target | Description |
|---------|--------|-------------|
| `npm run build` | App PWA | Build main app (Vite) |
| `npm run admin:deploy` | Admin | Build + deploy admin SPA |
| `npm run api:deploy` | Worker | Deploy API worker |
| `npm run cloud:check` | - | Health check API + env validation |

---

## 🔒 Security Notes

- `.env` dan `admin/.env.production` di-gitignore (sudah benar)
- Secrets hanya di Cloudflare Worker (via `wrangler secret put`)
- Public env vars (VITE_*) aman di Pages build config
- Service role key **tidak pernah** di client build

---

## 📊 Monitoring Deployment

### Check Deployment Status

1. **Cloudflare Dashboard:** https://dash.cloudflare.com/
2. **GitHub Actions** (setelah setup): https://github.com/gudangdigital5758/kasirgratisan/actions
3. **Health Check API:** https://api.profitku.my.id/health
4. **Test Admin:** https://dashboard.profitku.my.id/settings (login → uncheck action button → save)

### Expected Result After Deploy

- Settings page "Simpan Action Buttons" → ✅ **Sukses tersimpan**
- No more "Belum login" error
- Consistent dengan pattern existing di file yang sama
