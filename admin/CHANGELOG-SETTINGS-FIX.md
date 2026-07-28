# Settings Page Fixes — 2026-07-28

## Error yang ditemukan dari live test `https://dashboard.profitku.my.id/settings`

### 1. ✅ FIXED: Google GSI console error di halaman authenticated
**Error:**
```
Cross-Origin-Opener-Policy policy would block the window.postMessage call.
@ https://accounts.google.com/gsi/client:380
```

**Masalah:**
Google OAuth Provider di-load global di `main.tsx`, padahal hanya dibutuhkan di halaman `/login`. Ini menyebabkan Google GSI script mencoba `postMessage` di halaman yang sudah authenticated, yang trigger COOP warning.

**Fix:**
- **Pindahkan** `GoogleOAuthProvider` dari `admin/src/main.tsx` (global) ke `admin/src/pages/LoginPage.tsx` (lazy load).
- Google OAuth hanya di-load ketika user membuka `/login`, tidak di halaman admin lain (`/settings`, `/members`, dll).

**Impact:**
- Console error hilang di halaman authenticated.
- Bundle size halaman non-login lebih kecil (tidak load Google GSI script).
- Login flow tetap normal.

---

### 2. ✅ FIXED: Bug `normalizeActionButtons()` menghapus field existing
**Masalah:**
Fungsi `normalizeActionButtons()` di `SettingsPage.tsx` mengganti object `whatsNew` dengan object baru yang hanya punya `{ enabled, url: '' }`, sehingga field `label` (localized text) yang sudah ada di production DB akan **terhapus** ketika admin menyimpan.

**Kode lama (bug):**
```ts
if (normalized.whatsNew) {
  const { enabled } = normalized.whatsNew;
  normalized.whatsNew = { enabled, url: '' };  // ❌ Menghapus field label!
}
```

**Fix:**
```ts
if (normalized.whatsNew) {
  normalized.whatsNew = { ...normalized.whatsNew };  // ✅ Preserve semua field
}
```

**Impact:**
- Field `label` di `action_buttons.whatsNew` tidak akan hilang saat admin save.
- Data production aman dari overwrite tidak sengaja.

---

### 3. ⚠️ INFO: Health menunjukkan `fonnte: false`
**Status saat ini:**
```json
{
  "supabase": true,
  "resend": true,
  "fonnte": false,
  "paymentProvider": "midtrans",
  "adminAllowlistConfigured": true
}
```

**Bukan bug UI**, tapi indikator bahwa Worker secret `FONNTE_TOKEN` belum di-set di production.

**Action (opsional):**
- Jika notifikasi WhatsApp via Fonnte dipakai: set secret `FONNTE_TOKEN` di Cloudflare Worker.
- Jika Fonnte tidak dipakai production: tambahkan label "(optional)" di UI health check supaya tidak seperti error.

---

## Files changed
- `admin/src/main.tsx` — Remove global `GoogleOAuthProvider`
- `admin/src/pages/LoginPage.tsx` — Add lazy-loaded `GoogleOAuthProvider` wrapper
- `admin/src/pages/SettingsPage.tsx` — Fix `normalizeActionButtons()` to preserve existing fields

## Verification
```bash
cd admin
npm run build
# ✅ Build success, no TypeScript errors
```

Deploy ke `dashboard.profitku.my.id` untuk menghilangkan Google GSI console error di production.
