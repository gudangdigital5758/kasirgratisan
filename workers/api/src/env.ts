export interface Env {
  APP_ORIGIN: string;
  /** Origin admin SPA (dashboard.profitku.my.id) — CORS */
  ADMIN_ORIGIN?: string;
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
  MIDTRANS_SERVER_KEY?: string;
  MIDTRANS_IS_PRODUCTION?: string;
  XENDIT_SECRET_KEY?: string;
  WEBHOOK_SECRET?: string;
  /** OneSignal — App ID (boleh sama dengan VITE_ONESIGNAL_APP_ID di client) */
  ONESIGNAL_APP_ID?: string;
  /** OneSignal REST API Key (server only — jangan expose ke VITE_*) */
  ONESIGNAL_REST_API_KEY?: string;
  /** R2 binding (opsional) */
  BACKUP_BUCKET?: R2Bucket;
}
