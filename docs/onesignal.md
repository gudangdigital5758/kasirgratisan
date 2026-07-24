# OneSignal — push notification Profitku

Integrasi **dua arah**:

| Sisi | Peran |
|------|--------|
| **Client (PWA / app)** | Init SDK, minta izin, `login(externalId = Supabase user id)` |
| **Worker API** | Kirim push lewat REST (aktivasi langganan, dunning H-3/H-1) |

## 1. Buat app di OneSignal

1. Daftar di [onesignal.com](https://onesignal.com) — paket **Free** biasanya cukup untuk mulai.
2. **New App/Website** → pilih **Web** (PWA di `profitku.my.id`).
3. Site setup:
   - **Site URL:** `https://profitku.my.id` (dan origin staging jika ada)
   - **My site is not fully HTTPS** — biarkan unchecked di production
   - Localhost diizinkan di client (`allowLocalhostAsSecureOrigin: true`)
4. Catat:
   - **OneSignal App ID** (UUID) → client + Worker
   - **REST API Key** → **hanya** Worker secret (bukan `VITE_*`)

## 2. Client (app kasir)

File root `.env`:

```env
VITE_ONESIGNAL_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Restart `npm run dev` / rebuild.

Yang sudah terpasang di kode:

- `src/lib/onesignal.ts` — init SDK web v16 + native Capacitor plugin
- Service worker: `public/push/OneSignalSDKWorker.js` (scope `/push/`)
- Setelah login Cloud: `oneSignalLogin(profile.user.id)`
- Modal izin: `PushPermissionModal` (setelah login Google)
- Settings → **Notifikasi push** (status + tombol aktifkan)

## 3. Worker (kirim push)

Secrets:

```bash
cd workers/api
npx wrangler secret put ONESIGNAL_APP_ID
npx wrangler secret put ONESIGNAL_REST_API_KEY
```

Local `workers/api/.dev.vars`:

```env
ONESIGNAL_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ONESIGNAL_REST_API_KEY=os_v2_app_...
```

Push otomatis saat:

- Langganan Cloud **aktif** (setelah verify payment)
- **Dunning** H-3 / H-1 (cron)

Tes manual (hanya `PAYMENT_PROVIDER=mock`):

```http
POST /api/dev/notify-test
Content-Type: application/json

{ "userId": "<supabase-user-uuid>" }
```

`userId` = ID user Supabase (sama yang di-`oneSignalLogin`).

## 4. Migrasi DB (log channel push)

Jalankan:

- `supabase/migrations/20260724120000_notification_push_channel.sql`

Agar `notification_log.channel = 'push'` valid.

## 5. Alur user

```
Login Google (Cloud)
  → init OneSignal
  → oneSignalLogin(userId)
  → modal izin (sekali) / Settings → Aktifkan
  → browser minta permission
  → device terdaftar di OneSignal dengan External ID = userId

Server (bayar / dunning)
  → POST OneSignal include_aliases.external_id = [userId]
  → notifikasi muncul di HP/browser
```

## 6. Troubleshooting

| Gejala | Cek |
|--------|-----|
| Modal tidak muncul | `VITE_ONESIGNAL_APP_ID` kosong / sudah dismiss (`profitku_push_asked_v1`) / belum login Cloud |
| Izin denied | Settings browser → Notifikasi untuk site |
| Push server “ok” tapi tidak masuk | External ID harus sama; user sudah `login` di client; site URL OneSignal match domain |
| 401 dari API OneSignal | REST key salah / format Authorization |
| Android WebView | Web SDK terbatas; native plugin ada, FCM setup terpisah (lihat `docs/android-google-signin.md`) |

## 7. Keamanan

- **App ID** boleh di client (`VITE_`).
- **REST API Key** hanya Worker secrets.
- Jangan commit `.env` / `.dev.vars`.
