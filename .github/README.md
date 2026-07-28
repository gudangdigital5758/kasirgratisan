# GitHub Configuration - Profitku

Folder ini berisi konfigurasi GitHub Actions untuk CI/CD automation.

## 📁 Structure

```
.github/
├── workflows/
│   └── deploy.yml          # Smart auto-deploy untuk app, admin, API
├── SETUP-CI-CD.md          # Panduan lengkap setup GitHub Actions
└── README.md               # Dokumen ini
```

## 🚀 Quick Start

1. **Setup GitHub Secrets** (8 required)
2. **Push ke main** atau manual trigger
3. **Monitor di Actions tab**

Lihat: [`SETUP-CI-CD.md`](./SETUP-CI-CD.md) untuk panduan lengkap.

## 📋 Workflows

### `deploy.yml` - Deploy Profitku Cloud

**Trigger:**
- Push ke branch `main`
- Manual via GitHub Actions UI

**Jobs:**
1. `detect-changes` - Smart detection file yang berubah
2. `deploy-app` - Deploy PWA ke Cloudflare Pages (conditional)
3. `deploy-admin` - Deploy admin dashboard (conditional)
4. `deploy-api` - Deploy Hono Worker API (conditional)
5. `notify-success` - Summary deployment

**Benefits:**
- ✅ Hanya deploy yang berubah (hemat build minutes)
- ✅ Parallel builds untuk speed
- ✅ Type check sebelum deploy API
- ✅ Deployment summary di Actions

## 📚 Documentation

- [`SETUP-CI-CD.md`](./SETUP-CI-CD.md) - Setup GitHub Actions & Secrets (comprehensive guide)
- [`SECRETS-TEMPLATE.md`](./SECRETS-TEMPLATE.md) - GitHub Secrets copy-paste template
- [`MIGRATION-GUIDE.md`](./MIGRATION-GUIDE.md) - Pindah repo antar akun GitHub

## � Links

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Cloudflare Wrangler Action](https://github.com/cloudflare/wrangler-action)
