# GitHub Secrets Template

> ⚠️ **USANG (2026-08-15).** Pipeline aktif hanya butuh **2 secrets** per repo:
> `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (nilai VITE_* publik sudah di `env:`
> workflow). Dokumen ini (8 secrets) disimpan sebagai referensi sejarah.

Template untuk copy-paste setup GitHub Secrets.

**⚠️ JANGAN commit file ini dengan nilai actual secrets!**

---

## 📋 Required Secrets (8 total)

Copy template ini, isi nilai, lalu paste ke GitHub Secrets **satu per satu**.

### 1. CLOUDFLARE_API_TOKEN

```
<paste_cloudflare_api_token_here>
```

**Cara dapat:**
1. https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Custom Token
3. Permissions: Account/Pages (Edit), Zone/Workers (Edit)
4. Copy token

---

### 2. CLOUDFLARE_ACCOUNT_ID

```
<paste_8_char_account_id>
```

**Cara dapat:**
1. https://dash.cloudflare.com/
2. Klik account name → Account ID di sidebar (8 characters)

---

### 3. VITE_API_URL

```
https://api.profitku.my.id
```

**Production:** `https://api.profitku.my.id`  
**Staging:** (jika ada) `https://api-staging.profitku.my.id`

---

### 4. VITE_AUTH_API_URL

```
https://api.profitku.my.id
```

**Sama dengan VITE_API_URL** (untuk auth endpoint)

---

### 5. VITE_SUPABASE_URL

```
https://<project_ref>.supabase.co
```

**Cara dapat:**
1. https://supabase.com/dashboard/project/<project_id>
2. Settings → API → Project URL

**Example:** `https://zrlcmoffzwpopuhopkju.supabase.co`

---

### 6. VITE_SUPABASE_ANON_KEY

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpybGNtb2Zmendwb3B1aG9wa2p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MDIzNDcsImV4cCI6MjEwMDM3ODM0N30.0o288EowW0bhCt8yrAZq73lzGqfZWXU5bbwswWvpu-o
```

**Cara dapat:**
1. Supabase Dashboard → Settings → API
2. Project API keys → `anon` `public`
3. Copy key (long JWT string)

**⚠️ Ini adalah PUBLIC key, aman untuk client-side**

---

### 7. VITE_GOOGLE_CLIENT_ID

```
1040830182815-xxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

**Cara dapat:**
1. https://console.cloud.google.com/apis/credentials
2. OAuth 2.0 Client IDs → Web client
3. Copy Client ID

---

### 8. VITE_ONESIGNAL_APP_ID (Optional)

```
<onesignal_app_id>
```

**Cara dapat:**
1. https://app.onesignal.com/
2. Select your app → Settings → Keys & IDs → OneSignal App ID

**Optional:** Jika belum pakai OneSignal push notifications, bisa skip.

---

## 🔍 Verify Template dari .env Local

Jika sudah punya `.env` di root repo:

```bash
# Windows CMD
type .env

# PowerShell
Get-Content .env

# Git Bash / WSL
cat .env
```

Copy nilai `VITE_*` dari file ini.

---

## 📝 Paste ke GitHub Secrets

1. Buka: https://github.com/gudangdigital5758/kasirgratisan/settings/secrets/actions
2. Klik **"New repository secret"**
3. Name: `CLOUDFLARE_API_TOKEN` (exact, case-sensitive)
4. Value: paste token dari template
5. Klik **"Add secret"**
6. Ulangi untuk 7 secrets lainnya

---

## ✅ Verification Checklist

Setelah paste semua secrets:

- [ ] CLOUDFLARE_API_TOKEN (long string, dari Cloudflare dashboard)
- [ ] CLOUDFLARE_ACCOUNT_ID (8 characters alphanumeric)
- [ ] VITE_API_URL (https://api.profitku.my.id)
- [ ] VITE_AUTH_API_URL (https://api.profitku.my.id)
- [ ] VITE_SUPABASE_URL (https://xxx.supabase.co)
- [ ] VITE_SUPABASE_ANON_KEY (long JWT starting with eyJ...)
- [ ] VITE_GOOGLE_CLIENT_ID (ends with .apps.googleusercontent.com)
- [ ] VITE_ONESIGNAL_APP_ID (optional, UUID format)

**Total:** 7-8 secrets terdaftar di GitHub.

---

## 🔒 Security Notes

- ✅ GitHub Secrets encrypted at rest
- ✅ Tidak tampil di workflow logs (masked)
- ✅ Hanya VITE_* (public env vars) — aman untuk client build
- ❌ JANGAN paste `SUPABASE_SERVICE_ROLE_KEY` (hanya di Cloudflare Worker secrets)
- ❌ JANGAN paste `RESEND_API_KEY`, `FONNTE_TOKEN`, payment keys (hanya di Worker)

---

## 🔄 Update Secrets

Jika perlu update secret (rotate token, ganti Supabase project):

1. GitHub Repo → Settings → Secrets → Actions
2. Klik secret name
3. Klik **"Update secret"**
4. Paste new value → **"Update secret"**
5. Re-run failed workflow atau push baru untuk trigger deployment

---

**Template created:** 2026-07-27  
**For repo:** `gudangdigital5758/kasirgratisan`
