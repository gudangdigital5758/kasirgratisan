# Profitku — Architecture

> Batas runtime dan modul. Detail cloud/deploy: [profitku-cloud.md](./profitku-cloud.md).  
> Keputusan stabil: [DECISIONS.md](./DECISIONS.md).

## Ringkasan

Profitku adalah **POS offline-first** untuk UMKM. Data transaksi hidup di perangkat (IndexedDB). Cloud opsional untuk backup, langganan, dan notifikasi.

```
┌─────────────────────────────────────────────────────────────┐
│  Client: PWA (Vite/React) + Android (Capacitor, opsional)   │
│  Local SoT: Dexie / IndexedDB (kasirgratisan-db)            │
│  Auth lokal multi-user: PIN + permissions (opsional)        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS Bearer (Supabase access token)
┌───────────────────────────▼─────────────────────────────────┐
│  Cloudflare Worker  workers/api  (Hono)                     │
│  plans · profile · checkout · backups · stores · webhooks   │
└───────┬─────────────────────────────┬───────────────────────┘
        │                             │
   ┌────▼────┐                   ┌────▼─────┐
   │ Supabase│                   │ R2 bucket│
   │ Auth+DB │                   │ backups  │
   └────┬────┘                   └──────────┘
        │
   Resend (email) · Fonnte (WhatsApp) · Payment (mock → Midtrans/Xendit)
```

## Peta direktori

| Path | Peran |
|------|--------|
| `src/pages/*` | UI fitur (kasir, produk, laporan, settings) |
| `src/lib/db.ts` | Schema Dexie, migrasi lokal, hooks sync dirty |
| `src/lib/backup.ts` | Export/import JSON lokal (+ shared cloud payload) |
| `src/lib/cloud-api.ts` | Client thin ke Worker |
| `src/lib/cloud-auth.ts` + `supabase-client.ts` | Sesi cloud (Supabase Auth) |
| `src/lib/brand.ts` | Nama, domain, harga paket, flag Play |
| `src/lib/sync.ts` | Background push dirty records (subset; fase lanjut) |
| `src/i18n/` | id / en / ms |
| `workers/api/` | API edge production |
| `supabase/migrations/` | Schema cloud + RLS |
| `android/` | Capacitor wrapper (`com.profitku.app`) |

## Alur penting

### Kasir / transaksi (offline)

1. UI keranjang di `Cashier.tsx` (ideal: domain service terpisah).
2. Tulis `transactions` + `transactionItems` + penyesuaian `products.stock`.
3. **Target:** multi-table `db.transaction` + stok dari DB terkini (hindari race).
4. Harga/HPP snapshot di item transaksi untuk laporan historis.

### Backup lokal

1. `buildBackupData()` mengumpulkan tabel.
2. User unduh JSON atau restore lewat UI Settings.
3. Restore: snapshot → clear → bulkAdd → `sanitizeDatabaseDates` → rollback jika gagal.
4. `cloudStoreId` di-null-kan setelah restore (device-specific).

### Backup cloud

1. User login Google → Supabase session → Bearer ke Worker.
2. `POST /api/backups` (multipart) → object R2 + row `backups`.
3. List/download/delete lewat API; kuota dari entitlements / limit plan.
4. Auto-backup: `use-cloud-auto-backup` jika langganan aktif.

### Langganan

1. Satu plan: `cloud_monthly` (Rp 25.000).
2. Checkout (mock / gateway) → verify → row `subscriptions` + notif Resend/Fonnte.
3. Cron Worker dunning H-3 / H-1.
4. Entitlements: view / profile `has_sync` + `storage_limit_mb`.

### Multi-user lokal (bukan cloud role)

- Opt-in di settings toko.
- PIN di-hash (SHA-256 + deviceId salt) — obfuscation device-local, bukan security server-grade.
- Permission keys di `db.ts` / `auth.ts`; gate UI dengan `can()`.

## Auth cloud

```
Google ID token (GIS / native)
  → supabase.auth.signInWithIdToken
  → fallback POST /api/auth/google
  → access_token (+ refresh) di storage Supabase
  → Authorization: Bearer … ke api.profitku.my.id
```

Worker memvalidasi token lewat Supabase `/auth/v1/user` (bukan trust decode JWT mentah di production).

## Yang sengaja di luar arsitektur inti

- Portal B2B member catalog / sales CRM (domain MSC Grosir).
- AI multi-provider render studio (domain MSC Studio).
- Multi-device realtime sync penuh (belum; push partial + stub).

## Prinsip desain

1. Offline core tidak boleh rusak jika API down.
2. Secrets tidak pernah `VITE_*` kecuali public (anon key, Google client id).
3. Billing & storage quota ditegakkan di Worker.
4. Branding & harga paket terpusat di `brand.ts` + seed Supabase.
