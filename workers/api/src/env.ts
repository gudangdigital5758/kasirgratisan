export interface Env {
  APP_ORIGIN: string;
  /** Origin admin SPA (dashboard.profitku.my.id) — CORS */
  ADMIN_ORIGIN?: string;
  /** Origin SPA affiliator (affiliate.profitku.my.id) — CORS */
  AFFILIATE_ORIGIN?: string;
  /** Origin dashboard owner (cloud.profitku.my.id) — CORS */
  CLOUD_ORIGIN?: string;
  /** Origin API publik (fallback logoUrl) */
  API_ORIGIN?: string;
  /**
   * Comma-separated staff emails (Google/Supabase) yang boleh akses /admin/api/*
   * Contoh: you@gmail.com,ops@profitku.my.id
   */
  ADMIN_EMAILS?: string;
  SUPABASE_URL?: string;
  /** Service role — hanya di Worker, jangan expose ke client */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Anon key untuk validasi JWT user (opsional; bisa pakai JWKS) */
  SUPABASE_ANON_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  FONNTE_TOKEN?: string;
  /** midtrans | xendit | mock */
  PAYMENT_PROVIDER?: string;
  /** Midtrans Server Key (SB-... sandbox / Mid-server-... production) */
  MIDTRANS_SERVER_KEY?: string;
  /** true | 1 | production → pakai API production Midtrans */
  MIDTRANS_IS_PRODUCTION?: string;
  /** Client Key opsional (jika nanti embed snap.js di client) */
  MIDTRANS_CLIENT_KEY?: string;
  XENDIT_SECRET_KEY?: string;
  WEBHOOK_SECRET?: string;
  /** "production" → blokir PAYMENT_PROVIDER=mock & cron tanpa secret (BILL-006/SEC-003). */
  ENVIRONMENT?: string;
  /** "true" → aktifkan /api/dev/* (SEC-003; default nonaktif). */
  ENABLE_DEV_ROUTES?: string;
  /** OneSignal — App ID (boleh sama dengan VITE_ONESIGNAL_APP_ID di client) */
  ONESIGNAL_APP_ID?: string;
  /** OneSignal REST API Key (server only — jangan expose ke VITE_*) */
  ONESIGNAL_REST_API_KEY?: string;
  /** R2 binding (opsional) */
  BACKUP_BUCKET?: R2Bucket;
  /** Gate fase sync (M4): set "false" untuk menonaktifkan push/pull sementara. */
  SYNC_ENABLED?: string;
  /** SumoPod Payment Gateway — API key (X-Api-Key) project Managed Payment. */
  SUMOPOD_API_KEY?: string;
  /** SumoPod webhook signing secret (whsec_...) — dihasilkan dari Settings → Webhook. */
  SUMOPOD_WEBHOOK_SECRET?: string;
  /** SumoPod webhook token (whtok_...) — alternatif verifikasi sederhana. */
  SUMOPOD_WEBHOOK_TOKEN?: string;
}
