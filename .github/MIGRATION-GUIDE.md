# GitHub Account Migration Guide - Profitku

Panduan lengkap untuk pindah repo ke akun GitHub lain sambil maintain CI/CD workflow.

---

## 🎯 Scenario

Anda punya project Profitku di **2 akun GitHub** dan ingin:
1. Pindah repo ke akun lain
2. Maintain GitHub Actions workflow
3. Keep commit history
4. Update remote URLs di semua developer machines

---

## 📋 Pre-Migration Checklist

- [ ] **Backup lokal** - pastikan punya clone terbaru di local
- [ ] **List collaborators** - catat siapa saja yang punya access
- [ ] **Document secrets** - catat GitHub Secrets yang perlu di-setup ulang
- [ ] **Check integrations** - Cloudflare, Vercel, dll yang linked ke repo
- [ ] **Note open PRs/Issues** - jika ada, screenshot atau export

---

## 🔄 Migration Methods

### **Method 1: Transfer Repository (Recommended)**

Transfer ownership dalam 1 organisasi atau antar personal accounts.

#### Keuntungan:
✅ Maintain all commit history  
✅ Keep issues, PRs, stars, watchers  
✅ GitHub automatically redirects old URLs  
✅ Preserve releases & tags  

#### Langkah:

**A. Di Akun Sumber (Current Owner)**

1. Buka repo: https://github.com/gudangdigital5758/kasirgratisan
2. **Settings** → scroll ke bawah → **Danger Zone**
3. Klik **"Transfer"**
4. Masukkan:
   - New owner username (akun tujuan)
   - Repo name (biarkan sama: `kasirgratisan` atau ganti)
   - Ketik nama repo untuk confirm
5. Klik **"I understand, transfer this repository"**

**B. Di Akun Tujuan (New Owner)**

1. Terima transfer invitation (via email atau GitHub notifications)
2. Confirm transfer

**C. Update Local Git Remote** (semua developer)

```bash
# Check current remote
git remote -v

# Update remote URL ke owner baru
git remote set-url origin https://github.com/NEW_OWNER/kasirgratisan.git

# Verify
git remote -v

# Test connection
git fetch origin
```

**D. Re-setup GitHub Secrets** (New Owner Account)

GitHub Secrets **tidak ter-transfer**, harus setup ulang:

1. Buka: https://github.com/NEW_OWNER/kasirgratisan/settings/secrets/actions
2. Setup 8 secrets (sama seperti original):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `VITE_API_URL`
   - `VITE_AUTH_API_URL`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_ONESIGNAL_APP_ID`

📋 Gunakan `.github/SECRETS-TEMPLATE.md` untuk panduan.

**E. Verify GitHub Actions**

Push commit untuk trigger workflow:

```bash
git commit --allow-empty -m "chore: verify CI/CD after migration"
git push origin main
```

Check: https://github.com/NEW_OWNER/kasirgratisan/actions

**F. Update Cloudflare Pages Git Connection** (jika perlu)

Jika `profitku` Cloudflare Pages ter-link ke Git:

1. Dashboard → Workers & Pages → `profitku` (atau `profitku-admin`)
2. Settings → Builds & deployments
3. Jika menampilkan old repo URL:
   - Disconnect Git
   - Reconnect ke repo baru: `NEW_OWNER/kasirgratisan`

---

### **Method 2: Fork & Push (Alternative)**

Jika transfer tidak bisa (e.g., organization restriction), gunakan fork.

#### Langkah:

**A. Fork di Akun Tujuan**

1. Buka: https://github.com/gudangdigital5758/kasirgratisan
2. Klik **"Fork"** (top right)
3. Pilih akun tujuan
4. Klik **"Create fork"**

**B. Clone Fork Baru**

```bash
# Clone dari akun baru
git clone https://github.com/NEW_OWNER/kasirgratisan.git kasirgratisan-new
cd kasirgratisan-new

# Verify
git remote -v
```

**C. Add Upstream (Original Repo)**

```bash
# Add original sebagai upstream untuk sync updates
git remote add upstream https://github.com/gudangdigital5758/kasirgratisan.git

# Verify
git remote -v
# origin: NEW_OWNER (your fork)
# upstream: gudangdigital5758 (original)
```

**D. Sync Future Updates dari Original**

```bash
# Fetch dari original
git fetch upstream

# Merge ke local main
git checkout main
git merge upstream/main

# Push ke fork
git push origin main
```

**E. Setup GitHub Secrets & Actions** (sama seperti Method 1 step D-F)

---

### **Method 3: Duplicate Repository (Clean Slate)**

Membuat repo baru tanpa fork relationship.

#### Langkah:

**A. Bare Clone Original**

```bash
# Clone dengan --bare (no working directory)
git clone --bare https://github.com/gudangdigital5758/kasirgratisan.git
cd kasirgratisan.git
```

**B. Create New Empty Repo di Akun Tujuan**

1. GitHub → New repository
2. Name: `kasirgratisan` (atau nama lain)
3. **Jangan initialize** (no README, .gitignore, license)
4. Create repository

**C. Mirror Push ke Repo Baru**

```bash
# Push semua refs (branches, tags) ke repo baru
git push --mirror https://github.com/NEW_OWNER/kasirgratisan.git
```

**D. Delete Bare Clone & Clone Normal**

```bash
cd ..
rm -rf kasirgratisan.git

# Clone repo baru untuk kerja normal
git clone https://github.com/NEW_OWNER/kasirgratisan.git
cd kasirgratisan
```

**E. Setup GitHub Secrets & Actions** (sama seperti Method 1 step D-F)

---

## 🔑 GitHub Secrets Migration Checklist

**Source:** Old GitHub account  
**Destination:** New GitHub account

Secrets yang perlu di-copy (manual, karena encrypted):

```bash
# From old repo settings, note down:
# https://github.com/OLD_OWNER/kasirgratisan/settings/secrets/actions
```

| Secret Name | Status | Notes |
|------------|--------|-------|
| CLOUDFLARE_API_TOKEN | [ ] | Copy dari Cloudflare (generate new jika perlu) |
| CLOUDFLARE_ACCOUNT_ID | [ ] | Same value (account ID tidak berubah) |
| VITE_API_URL | [ ] | `https://api.profitku.my.id` |
| VITE_AUTH_API_URL | [ ] | `https://api.profitku.my.id` |
| VITE_SUPABASE_URL | [ ] | Copy dari local `.env` |
| VITE_SUPABASE_ANON_KEY | [ ] | Copy dari local `.env` |
| VITE_GOOGLE_CLIENT_ID | [ ] | Copy dari local `.env` |
| VITE_ONESIGNAL_APP_ID | [ ] | Copy dari local `.env` (optional) |

---

## 🔄 Update Collaborators

**Old Repo:**
- List collaborators: Settings → Collaborators

**New Repo:**
1. Settings → Collaborators → **Add people**
2. Masukkan username atau email
3. Pilih role: Write, Maintain, atau Admin
4. Send invitation

---

## 🌐 Update External Integrations

### Cloudflare Pages

**If Git-connected:**
1. Dashboard → Workers & Pages → `profitku`
2. Settings → Builds & deployments → Source
3. Disconnect old repo
4. Connect new repo: `NEW_OWNER/kasirgratisan`

**If Wrangler CLI deploy:**
- No change needed (CLI deploy langsung, tidak peduli Git remote)

### Cloudflare Workers (API)

- No change needed
- Worker secrets tetap di Cloudflare (tidak linked ke GitHub)

### Supabase

- No change needed
- Supabase project tidak linked ke GitHub repo

### Google OAuth

**If authorized origins linked to repo URL:**
- No change needed (OAuth linked ke domain, bukan repo)

---

## 📝 Update Documentation

Setelah migration, update:

**1. README.md**

```markdown
# Profitku

...

## Repository

**GitHub:** https://github.com/NEW_OWNER/kasirgratisan
```

**2. package.json (jika ada repository field)**

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/NEW_OWNER/kasirgratisan.git"
  }
}
```

**3. .github/SETUP-CI-CD.md**

Update link GitHub Actions:
```markdown
https://github.com/NEW_OWNER/kasirgratisan/actions
https://github.com/NEW_OWNER/kasirgratisan/settings/secrets/actions
```

**4. DEPLOYMENT-ANALYSIS.md**

Update repo references.

**5. Commit & Push Changes**

```bash
git add README.md package.json .github/
git commit -m "docs: update repo URLs after migration to NEW_OWNER"
git push origin main
```

---

## ✅ Post-Migration Verification

### 1. Local Git Remote

```bash
git remote -v
# Should show NEW_OWNER URLs
```

### 2. GitHub Actions

```bash
# Trigger workflow
git commit --allow-empty -m "chore: test CI/CD post-migration"
git push origin main
```

Check: https://github.com/NEW_OWNER/kasirgratisan/actions

### 3. Cloudflare Deployments

- App: https://profitku.my.id
- Admin: https://dashboard.profitku.my.id
- API health: https://api.profitku.my.id/health

### 4. Collaborators Access

Ask team members:
```bash
git pull origin main
# Should work without auth issues
```

---

## 🚨 Rollback Plan

Jika migration bermasalah:

**Immediate:**
1. **Local:** `git remote set-url origin https://github.com/OLD_OWNER/kasirgratisan.git`
2. **Cloudflare:** Revert Git connection ke old repo
3. Continue development di old repo

**Long-term:**
- Investigate migration issue
- Re-attempt saat tidak ada active development

---

## 🎓 Best Practices

### Timing Migration

✅ **Good times:**
- Setelah release / stable branch
- Low development activity period
- Sebelum major feature development

❌ **Avoid:**
- Saat ada active PRs
- Sprint deadline
- Production hotfix in progress

### Communication

1. **Notify team** 24-48 jam sebelumnya
2. **Set status** "Repo migrating" di README
3. **Update remote** instruksi via Slack/email
4. **Verify** semua team member bisa akses

### Backup

```bash
# Backup local sebelum migration
cd ..
cp -r kasirgratisan kasirgratisan-backup-$(date +%Y%m%d)
```

---

## 📞 Troubleshooting

| Issue | Solution |
|-------|----------|
| ❌ `remote: Repository not found` | Update remote URL: `git remote set-url origin <new_url>` |
| ❌ GitHub Actions fail | Re-setup 8 GitHub Secrets di new repo |
| ❌ Permission denied | Check collaborator invite accepted |
| ❌ Cloudflare build fail | Reconnect Git in Pages settings |
| ⚠️ Old repo still accessible | GitHub redirects old URL → new for 1 year (after transfer) |

---

## 🔗 Comparison: Personal vs Organization Account

| Feature | Personal Account | Organization Account |
|---------|------------------|---------------------|
| **GitHub Actions minutes** | Free: 2000/month | Free: 2000/month (or more with paid) |
| **Private collaborators** | Unlimited (free tier) | Team management |
| **Repository transfer** | ✅ Easy | ✅ Easy |
| **Team permissions** | Basic (read/write/admin) | Advanced (custom roles) |
| **Billing** | Individual | Shared team billing |
| **CI/CD** | Same workflow | Same workflow |

**Recommendation:** 
- **Personal:** Solo dev atau small team (2-3 people)
- **Organization:** Team 4+ dengan role-based access control

---

## 📚 Resources

- [GitHub: Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [GitHub: Duplicating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository)
- [Git: Changing a remote's URL](https://docs.github.com/en/get-started/getting-started-with-git/managing-remote-repositories#changing-a-remotes-url)

---

**Guide created:** 2026-07-27  
**For:** Profitku repository migration  
**Repo:** `kasirgratisan`
