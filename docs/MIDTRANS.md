# Midtrans Snap — Profitku Cloud

Payment production untuk paket **Rp 25.000 / bulan**.  
Provider di Worker: `PAYMENT_PROVIDER=midtrans`.

---

## 1. Daftar akun

1. Buka [https://dashboard.midtrans.com](https://dashboard.midtrans.com)  
2. Daftar / login  
3. Mulai di **Sandbox** dulu  

### Keys (Settings → Access Keys)

| Key | Dipakai di |
|-----|------------|
| **Server Key** (`SB-Mid-server-…` sandbox) | Worker secret `MIDTRANS_SERVER_KEY` |
| **Client Key** (`SB-Mid-client-…`) | Opsional (embed Snap.js nanti) |

Jangan commit key ke Git.

---

## 2. Secrets Worker

```bash
cd workers/api

npx wrangler secret put PAYMENT_PROVIDER
# value: midtrans

npx wrangler secret put MIDTRANS_SERVER_KEY
# value: SB-Mid-server-...

npx wrangler secret put MIDTRANS_IS_PRODUCTION
# value: false   (sandbox)
# value: true    (production keys)
```

Lokal — `workers/api/.dev.vars`:

```env
PAYMENT_PROVIDER=midtrans
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
MIDTRANS_IS_PRODUCTION=false
```

Deploy:

```bash
npm run api:deploy
```

Cek:

```bash
curl https://api.profitku.my.id/health
# "paymentProvider":"midtrans", "midtrans":true
```

---

## 3. Webhook (HTTP Notification)

Dashboard Midtrans → **Settings → Configuration**:

| Field | Value |
|-------|--------|
| **Payment Notification URL** | `https://api.profitku.my.id/webhook/payment` |
| Finish / Unfinish / Error redirect | Boleh dikosongkan; Snap `callbacks.finish` sudah di-set ke `/settings/cloud?pending=…` |

Simpan. Midtrans menandatangani notifikasi dengan `signature_key` (SHA-512) — Worker memverifikasi dengan Server Key.

---

## 4. Alur bayar

```text
User klik Langganan di app
  → POST /api/payments/checkout
  → Worker buat row payments PENDING + Snap transaction (order_id = payment UUID)
  → Client buka paymentLink (redirect_url Midtrans)
  → User bayar (QRIS/VA/e-wallet di sandbox)
  → Midtrans webhook → /webhook/payment → COMPLETED + subscription 30 hari + email/push
  → User kembali ke /settings/cloud?pending=…
  → Client poll verify → status COMPLETED
```

---

## 5. Sandbox — kartu / QR uji

Lihat [Midtrans Testing](https://docs.midtrans.com/docs/testing-payment-on-sandbox) untuk nomor kartu & skenario sukses/gagal.

---

## 6. Production

1. Lengkapi dokumen bisnis di Midtrans (activate production)  
2. Ganti Server Key **production**  
3. `MIDTRANS_IS_PRODUCTION=true`  
4. `PAYMENT_PROVIDER=midtrans`  
5. Webhook URL production (sama path)  
6. Tes nominal kecil / 25rb sekali  

---

## 7. Kembali ke mock (dev)

```env
PAYMENT_PROVIDER=mock
```

Checkout kembali auto-aktif tanpa Midtrans.

---

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| 503 MIDTRANS_SERVER_KEY | Secret belum di-set / typo |
| Snap error amount | Harga plan dari Supabase harus integer IDR |
| Webhook 401 | Server Key sandbox vs production mismatch |
| Bayar sukses tapi sub belum aktif | Webhook URL, log Worker, lalu tombol “Saya sudah bayar” (verify) |
| order not found | order_id harus = payment id UUID internal |
