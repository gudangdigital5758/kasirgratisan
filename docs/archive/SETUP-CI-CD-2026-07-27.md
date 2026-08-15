# Setup GitHub Actions CI/CD untuk Profitku

> ⚠️ **USANG (2026-08-15).** Pipeline aktif = `.github/workflows/ci.yml` dengan **2 secrets**
> (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) di kedua repo. Dokumen ini menyebut
> `deploy.yml` lama & 8 secrets — disimpan hanya sebagai referensi sejarah.
> Panduan terkini: `docs/GIT-WORKFLOW.md` + `docs/IMPLEMENTATION-PLAN-ADMIN-SYNC.md`.

Panduan aktivasi workflow `.github/workflows/deploy.yml` untuk smart auto-deploy.

---

## 🎯 Fitur Workflow

✅ **Smart detection** - hanya deploy project yang berubah  
✅ **Parallel builds** - app, admin, dan API bisa deploy bersamaan  
✅ **Type check** - Worker API di-validate sebelum deploy  
✅ **Manual trigger** - bisa trigger deploy manual via GitHub UI  
✅ **Deployment summary** - status setiap project di GitHub Actions

---

## 📋 Setup GitHub Secrets

Buka **GitHub Repository → Settings → Secrets and variables → Actions → New repository secret**

### Required Secrets

| Secret Name | Value | Deskripsi |
|------------|-------|-----------|
| `CLOUDFLARE_API_TOKEN` | `<token>` | Cloudflare API token dengan permission Pages & Workers |
| `CLOUDFLARE_ACCOUNT_ID` | `<account_id>` | Cloudflare Account ID |
| `VITE_API_URL` | `https://api.profitku.my.id` | Production API URL |
| `VITE_AUTH_API_URL` | `https://api.profitku.my.id` | Auth API URL (sama dengan API URL) |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` | Supabase anon/public key |
| `VITE_GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` | Google OAuth Web Client ID |
| `VITE_ONESIGNAL_APP_ID` | `<app_id>` | OneSignal App ID (optional) |

---

## 🔑 Cara Mendapatkan Cloudflare API Token

### 1. Login ke Cloudflare Dashboard

Buka: https://dash.cloudflare.com/profile/api-tokens

### 2. Create Token

Klik **"Create Token"** → **"Create Custom Token"**

### 3. Token Configuration

**Token name:** `GitHub Actions - Profitku Deploy`

**Permissions:**
- Account → Cloudflare Pages → Edit
- Account → Account Settings → Read
- Zone → Workers Scripts → Edit (jika API worker perlu deploy)

**Account Resources:**
- Include → `<Your Account>`

**Zone Resources:**
- Include → Specific zone → `profitku.my.id`

**Client IP Address Filtering:** (leave empty)

**TTL:** (leave default atau set expiry sesuai kebutuhan)

### 4. Copy Token

Setelah create, **copy token** (hanya muncul sekali) dan simpan di GitHub Secrets sebagai `CLOUDFLARE_API_TOKEN`.

### 5. Get Account ID

Dashboard → klik account name → **Account ID** di sidebar (8 digit alphanumeric).

Simpan sebagai `CLOUDFLARE_ACCOUNT_ID` di GitHub Secrets.

---

## 📝 Get Secrets dari Local Environment

Jika sudah punya `.env` di local:

```bash
# From root repo
cat .env
```

Copy value untuk:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_ONESIGNAL_APP_ID`

---

## ✅ Verifikasi Setup

### 1. Check Secrets

GitHub Repo → **Settings → Secrets and variables → Actions**

Pastikan semua 8 secrets sudah terdaftar (atau 7 jika skip OneSignal).

### 2. Test Workflow

**Opsi A: Push ke main**

```bash
# Buat perubahan kecil (misalnya edit README)
git add .
git commit -m "test: trigger CI/CD workflow"
git push origin main
```

**Opsi B: Manual Trigger**

GitHub Repo → **Actions → Deploy Profitku Cloud → Run workflow → Run workflow**

### 3. Monitor Deployment

GitHub Repo → **Actions** → klik workflow run terbaru

Lihat:
- ✅ Detect Changes (mendeteksi file apa yang berubah)
- ✅ Deploy App / Admin / API (sesuai yang berubah)
- ✅ Summary di bagian bawah

### 4. Verify Production

Setelah workflow success:

```bash
# Check health API
curl https://api.profitku.my.id/health

# Check PWA
# https://profitku.my.id

# Check Admin
# https://dashboard.profitku.my.id
```

---

## 🚀 Cara Pakai Setelah Setup

### Auto-Deploy on Push

Setiap push ke branch `main` akan:
1. Detect file apa yang berubah (app / admin / api)
2. Hanya build & deploy project yang berubah
3. Skip project yang tidak berubah (menghemat build minutes)

**Contoh:**
- Edit `src/pages/Settings.tsx` → hanya deploy **app**
- Edit `admin/src/pages/SettingsPage.tsx` → hanya deploy **admin**
- Edit `workers/api/src/routes/backup.ts` → hanya deploy **api**
- Edit `admin/**` + `workers/api/**` → deploy **admin + api** (parallel)

### Manual Deploy

GitHub Repo → **Actions → Deploy Profitku Cloud → Run workflow**

Pilih branch (default: main) → **Run workflow**

Berguna untuk:
- Re-deploy tanpa perubahan code (rebuild)
- Deploy setelah update GitHub Secrets
- Rollback (checkout commit lama, lalu manual trigger)

---

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| ❌ `Error: Unable to find Pages project` | Pastikan project name di workflow (`profitku`, `profitku-admin`) match dengan Cloudflare |
| ❌ `Authentication error` | Check `CLOUDFLARE_API_TOKEN` permission & expiry |
| ❌ `Account ID not found` | Verify `CLOUDFLARE_ACCOUNT_ID` (8 char alphanumeric) |
| ❌ Build fail: `VITE_* is not defined` | Check GitHub Secrets, pastikan semua VITE_* secrets terdaftar |
| ⚠️ Workflow skip all jobs | No file changes detected (normal jika edit README / docs saja) |
| ⚠️ Admin build fail: `npm ci` error | Pastikan `admin/package-lock.json` ter-commit |

### Debug Mode

Edit `.github/workflows/deploy.yml`, tambahkan di job yang bermasalah:

```yaml
- name: Debug secrets (REMOVE AFTER DEBUG)
  run: |
    echo "VITE_API_URL length: ${#VITE_API_URL}"
    echo "VITE_SUPABASE_URL length: ${#VITE_SUPABASE_URL}"
  env:
    VITE_API_URL: ${{ secrets.VITE_API_URL }}
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
```

**⚠️ JANGAN print secret value, hanya print length/check existence.**

---

## 📊 Monitoring

### GitHub Actions Dashboard

- **History:** GitHub Repo → Actions → filter by workflow/branch
- **Status badge:** (optional) tambah ke README.md

```markdown
![Deploy Status](https://github.com/gudangdigital5758/kasirgratisan/actions/workflows/deploy.yml/badge.svg)
```

### Cloudflare Dashboard

- **App:** https://dash.cloudflare.com/ → Workers & Pages → `profitku`
- **Admin:** https://dash.cloudflare.com/ → Workers & Pages → `profitku-admin`
- **API:** https://dash.cloudflare.com/ → Workers & Pages → `profitku-api`

Setiap deployment akan tercatat di **Deployments** tab dengan:
- Commit hash
- Timestamp
- Build duration
- Deployment URL (production + preview)

---

## 🔒 Security Notes

- API token disimpan di GitHub Secrets (encrypted at rest)
- Worker secrets (service role, Fonnte, Resend, Midtrans) **TIDAK** di GitHub Actions
- Worker secrets tetap di Cloudflare via `wrangler secret put` (sudah benar)
- Public env vars (VITE_*) aman di GitHub Secrets & build logs

---

## 🎓 Best Practices

1. ✅ **Commit message jelas** - workflow run menggunakan commit message sebagai title
2. ✅ **PR preview** (future) - bisa extend workflow untuk deploy PR ke preview URL
3. ✅ **Rollback strategy** - checkout commit lama → manual trigger workflow
4. ✅ **Build cache** - workflow sudah pakai `cache: 'npm'` untuk speed up
5. ✅ **Fail fast** - workflow stop di job pertama yang fail (hemat build minutes)

---

## 📈 Estimasi Build Minutes (GitHub Free: 2000/month)

| Trigger | Build Minutes | Frequency |
|---------|---------------|-----------|
| Edit app only | ~3-4 min | 10-15x/month |
| Edit admin only | ~2-3 min | 5-10x/month |
| Edit API only | ~1-2 min | 5-10x/month |
| Edit all 3 | ~5-6 min (parallel) | Rare |

**Estimasi usage:** 50-100 build minutes/month (comfortable untuk free tier).

Jika exceed, bisa:
1. Limit workflow run (skip docs-only commits)
2. Upgrade ke GitHub Pro ($4/month = 3000 build minutes)
3. Self-hosted runner (advanced)

---

## ✅ Checklist Aktivasi

- [ ] 1. Setup 8 GitHub Secrets (Cloudflare token, Account ID, VITE_*)
- [ ] 2. Verify secrets terdaftar di repo Settings
- [ ] 3. Push commit atau manual trigger workflow
- [ ] 4. Monitor workflow di Actions tab
- [ ] 5. Verify deployment di Cloudflare dashboard
- [ ] 6. Test production URL (app, admin, API health)
- [ ] 7. Update `DEPLOYMENT-ANALYSIS.md` status (CI/CD active)
- [ ] 8. (Optional) Add workflow status badge ke README
- [ ] 9. Disable manual Cloudflare Pages Git connection untuk `profitku` (avoid double build)

---

**Setup oleh:** Kiro AI  
**Tanggal:** 2026-07-27  
**Workflow file:** `.github/workflows/deploy.yml`
