/**
 * Profitku Cloud API — Cloudflare Worker
 *
 * Entry point: middleware global + mounting modul route (pola controller).
 * Handler bisnis dipisah ke `routes/` agar index.ts tetap ramping:
 *   - routes/auth.ts, catalog.ts (plans/app-settings), profile.ts
 *   - routes/payments.ts, vouchers.ts, stores.ts, sync.ts, backups.ts
 *   - routes/cron.ts, dev.ts
 *   - routes/admin.ts, affiliate.ts, admin-affiliates.ts (existing)
 * Webhook & cron tetap di sini.
 *
 * Path yang dipakai `src/lib/cloud-api.ts` di app:
 *  - GET  /api/plans
 *  - GET  /api/user/profile
 *  - POST /api/payments/checkout
 *  - POST /api/payments/verify/:id
 *  - GET  /api/payments/history
 *  - CRUD /api/stores...
 *  - backup + sync
 *
 * Auth: Bearer token (Supabase access token, atau Google ID token di fase migrasi).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { getUserFromJwt, sbGet, sbPatch } from './lib/supabase';
import { sendEmail } from './lib/notify';
import { r2Configured, cleanupExpiredBackups } from './lib/backups';
import { runDunningCron } from './lib/lifecycle';
import { resolveAdmin, writeEvent } from './lib/admin';
import { isMaintenanceMode } from './lib/platform-settings';
import { rateLimit, rateLimitKey } from './lib/rate-limit';
import {
  isFailureStatus,
  isPaidStatus,
  isPendingStatus,
  midtransConfigured,
  verifyNotificationSignature,
} from './lib/midtrans';
import { fulfillCompletedPayment } from './lib/payments';

import adminRoutes from './routes/admin';
import affiliateRoutes from './routes/affiliate';
import authRoutes from './routes/auth';
import catalogRoutes from './routes/catalog';
import profileRoutes from './routes/profile';
import vouchersRoutes from './routes/vouchers';
import paymentsRoutes from './routes/payments';
import storesRoutes from './routes/stores';
import syncRoutes from './routes/sync';
import backupsRoutes from './routes/backups';
import cronRoutes from './routes/cron';
import devRoutes from './routes/dev';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ISSUE_REPORT_MAX_BYTES = 32 * 1024;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.use('*', async (c, next) => {
  const origin = c.env.APP_ORIGIN || 'https://profitku.my.id';
  const adminOrigin = c.env.ADMIN_ORIGIN || 'https://dashboard.profitku.my.id';
  const affiliateOrigin = c.env.AFFILIATE_ORIGIN || 'https://affiliate.profitku.my.id';
  return cors({
    origin: [
      origin,
      adminOrigin,
      affiliateOrigin,
      'http://localhost:8080',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:5179',
      'http://127.0.0.1:5179',
      'capacitor://localhost',
      'http://localhost',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

/** Auth middleware shared by /api/* dan /admin/api/* */
async function bearerAuth(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
  set: (k: 'userId' | 'userEmail' | 'bearer', v: string | null) => void;
}, next: () => Promise<void>) {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  c.set('bearer', token);
  c.set('userId', null);
  c.set('userEmail', null);

  // Never trust an undecoded JWT payload. If Supabase validation is not
  // configured, protected routes remain unauthenticated and fail closed.
  if (token && c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY) {
    const user = await getUserFromJwt(c.env, token);
    if (user) {
      c.set('userId', user.id);
      c.set('userEmail', user.email ?? null);
    }
  }

  await next();
}

app.use('/api/*', bearerAuth);
app.use('/admin/api/*', bearerAuth);

/**
 * Maintenance mode: saat platform_settings.maintenance_mode=true, tolak request
 * user (/api/* dan /admin/api/*) dengan 503. Pengecualian:
 *  - /api/cron/* — job terjadwal tetap jalan.
 *  - staff admin terautentikasi — agar bisa mematikan maintenance dari admin UI.
 * /health dan /webhook/* tidak di-mount di middleware ini sehingga tetap terbuka.
 */
async function maintenanceMiddleware(c: {
  env: Env;
  get: (k: 'userId' | 'userEmail' | 'bearer') => string | null;
  req: { path: string };
  json: (b: unknown, s?: number, h?: Record<string, string>) => Response;
}, next: () => Promise<void>) {
  const path = c.req.path;
  if (path.startsWith('/api/cron/')) return next();
  let maintenance = false;
  try {
    maintenance = await isMaintenanceMode(c.env);
  } catch {
    maintenance = false;
  }
  if (!maintenance) return next();
  const userId = c.get('userId');
  if (userId) {
    try {
      const admin = await resolveAdmin(c.env, userId, c.get('userEmail'));
      if (admin) return next();
    } catch {
      /* lanjut tolak */
    }
  }
  return c.json(
    { error: 'Platform sedang dalam perbaikan. Silakan coba lagi nanti.' },
    503,
    { 'Retry-After': '3600' },
  );
}

app.use('/api/*', maintenanceMiddleware);
app.use('/admin/api/*', maintenanceMiddleware);

/** Rate limit per user/IP untuk route terautentikasi (membatasi penyalahgunaan ringan). */
async function rateLimitMiddleware(c: {
  get: (k: 'userId') => string | null;
  req: { header: (n: string) => string | undefined };
  json: (b: unknown, s?: number, h?: Record<string, string>) => Response;
}, next: () => Promise<void>) {
  const key = rateLimitKey(c.get('userId'), c);
  const { allowed, retryAfterSeconds } = rateLimit(key, 120, 60_000);
  if (!allowed) {
    return c.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' }, 429, {
      'Retry-After': String(retryAfterSeconds),
    });
  }
  await next();
}

app.use('/api/*', rateLimitMiddleware);
app.use('/admin/api/*', rateLimitMiddleware);

/** Staff admin console API */
app.route('/admin/api', adminRoutes);

/** Affiliate — lookup publik + register/me/tree/commissions (auth) */
app.route('/api/affiliate', affiliateRoutes);

// === Business routes (pola controller, dipisah per domain) ===
// Semua modul di-mount di /api — middleware /api/* di atas tetap berlaku.
app.route('/api', authRoutes); // /auth/google
app.route('/api', catalogRoutes); // /plans, /app-settings/:key
app.route('/api', profileRoutes); // /user/profile
app.route('/api', vouchersRoutes); // /vouchers/preview
app.route('/api', paymentsRoutes); // /payments/checkout|verify|history|google-play
app.route('/api', storesRoutes); // /stores, /stores/:id
app.route('/api', syncRoutes); // /sync/push, /sync/pull, /stores/:storeId/sync
app.route('/api', backupsRoutes); // /backups, /backups/:id/...
app.route('/api', cronRoutes); // /cron/dunning, /cron/cleanup-backups
app.route('/api', devRoutes); // /dev/notify-test (mock only)

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'profitku-api',
    domain: 'api.profitku.my.id',
    supabase: Boolean(c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY),
    r2: r2Configured(c.env),
    resend: Boolean(c.env.RESEND_API_KEY),
    fonnte: Boolean(c.env.FONNTE_TOKEN),
    onesignal: Boolean(c.env.ONESIGNAL_APP_ID && c.env.ONESIGNAL_REST_API_KEY),
    paymentProvider: (c.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    midtrans: midtransConfigured(c.env),
    time: new Date().toISOString(),
  }),
);

// Webhooks internal
app.get('/webhook/latest-version', (c) => {
  // Fire-and-forget ping dari client — cukup 204
  return c.body(null, 204);
});

app.post('/webhook/issue-report', async (c) => {
  const { allowed, retryAfterSeconds } = rateLimit(rateLimitKey(null, c), 10, 60_000);
  if (!allowed) {
    return c.json({ error: 'Terlalu banyak laporan. Coba lagi nanti.' }, 429, {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  const contentLength = Number(c.req.header('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > ISSUE_REPORT_MAX_BYTES) {
    return c.json({ error: 'Laporan terlalu besar' }, 413);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Payload tidak valid' }, 400);

  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > ISSUE_REPORT_MAX_BYTES) {
    return c.json({ error: 'Laporan terlalu besar' }, 413);
  }

  // Do not write user-provided report contents to logs. They may contain PII.
  console.log('[issue-report] accepted', { bytes: serialized.length });
  if (c.env.RESEND_API_KEY) {
    await sendEmail(c.env, {
      to: 'support@profitku.my.id',
      subject: '[Profitku] Issue report',
      html: `<pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>`,
    });
  }
  return c.json({ ok: true });
});

app.post('/webhook/user-type', async (c) => {
  const { allowed, retryAfterSeconds } = rateLimit(rateLimitKey(null, c), 20, 60_000);
  if (!allowed) {
    return c.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, 429, {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Jangan log isi penuh — bisa berisi identifier device (PII ringan).
  const businessType = typeof body['business-type'] === 'string' ? body['business-type'] : 'unknown';
  console.log('[user-type]', { bytes: JSON.stringify(body).length, businessType });
  return c.json({ ok: true });
});

/** Auto-report error client (PWA) → platform_events untuk dilihat admin. */
app.post('/webhook/client-error', async (c) => {
  const { allowed, retryAfterSeconds } = rateLimit(rateLimitKey(null, c), 20, 60_000);
  if (!allowed) {
    return c.json({ error: 'Too many' }, 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  const contentLength = Number(c.req.header('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return c.json({ error: 'Too large' }, 413);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid' }, 400);
  if (JSON.stringify(body).length > 8192) return c.json({ error: 'Too large' }, 413);

  // Jangan log isi penuh (bisa berisi stack lokal/PII). Simpan ringkas ke platform_events.
  const message = typeof body.message === 'string' ? body.message.slice(0, 300) : 'client error';
  console.log('[client-error]', { type: body.type, bytes: JSON.stringify(body).length });
  await writeEvent(c.env, {
    level: 'error',
    source: 'client',
    type: 'client_error',
    message,
    payload: {
      ...(body as Record<string, unknown>),
      stack: typeof body.stack === 'string' ? body.stack.slice(0, 1000) : undefined,
    },
  });
  return c.json({ ok: true });
});

/**
 * Midtrans payment notification (HTTP Notification).
 * Dashboard: Settings → Configuration → Payment Notification URL
 *   https://api.profitku.my.id/webhook/payment
 *
 * Tidak memakai WEBHOOK_SECRET header — verifikasi via signature_key SHA512.
 */
app.post('/webhook/payment', async (c) => {
  // Batas generous (60/menit/IP) — Midtrans bisa kirim retry, tapi tetap dibatasi.
  const { allowed, retryAfterSeconds } = rateLimit(rateLimitKey(null, c), 60, 60_000);
  if (!allowed) {
    return c.json({ error: 'Terlalu banyak permintaan' }, 429, {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = String(body.order_id || '');
  const statusCode = String(body.status_code || '');
  const grossAmount = String(body.gross_amount || '');
  const signatureKey = String(body.signature_key || '');
  const transactionStatus = String(body.transaction_status || '');
  const fraudStatus = body.fraud_status ? String(body.fraud_status) : undefined;

  console.log('[payment-webhook]', orderId, transactionStatus, fraudStatus);

  if (!orderId) return c.json({ error: 'order_id missing' }, 400);

  const provider = (c.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (provider === 'midtrans' || signatureKey) {
    if (!midtransConfigured(c.env)) {
      console.warn('[payment-webhook] midtrans not configured');
      return c.json({ error: 'midtrans_not_configured' }, 503);
    }
    const ok = await verifyNotificationSignature(c.env, {
      orderId,
      statusCode,
      grossAmount,
      signatureKey,
    });
    if (!ok) {
      console.warn('[payment-webhook] invalid signature', orderId);
      return c.json({ error: 'invalid signature' }, 401);
    }

    try {
      type Pay = { id: string; user_id: string; status: string };
      const pays = await sbGet<Pay[]>(
        c.env,
        `payments?id=eq.${orderId}&select=id,user_id,status&limit=1`,
      );
      const pay = pays[0];
      if (!pay) {
        console.warn('[payment-webhook] payment not found', orderId);
        return c.json({ ok: true, skipped: 'unknown_order' });
      }

      if (isPaidStatus(transactionStatus, fraudStatus)) {
        await fulfillCompletedPayment(c.env, {
          paymentId: orderId,
          userId: pay.user_id,
          provider: 'midtrans',
          providerRef: String(body.transaction_id || orderId),
          midtransRaw: body,
        });
        return c.json({ ok: true, status: 'COMPLETED' });
      }

      if (isFailureStatus(transactionStatus)) {
        if (pay.status !== 'COMPLETED') {
          await sbPatch(c.env, `payments?id=eq.${orderId}`, {
            status: 'FAILED',
            raw: { midtrans: body },
          });
        }
        return c.json({ ok: true, status: 'FAILED' });
      }

      if (isPendingStatus(transactionStatus)) {
        return c.json({ ok: true, status: 'PENDING' });
      }

      return c.json({ ok: true, status: transactionStatus });
    } catch (err) {
      console.error('[payment-webhook] fulfill', err);
      return c.json({ error: 'processing_failed' }, 500);
    }
  }

  // Non-midtrans: optional shared secret
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const hdr = c.req.header('x-webhook-secret') || c.req.header('x-callback-token');
    if (hdr !== secret) return c.json({ error: 'Unauthorized' }, 401);
  }
  return c.json({ ok: true, ignored: true });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('[api]', err);
  return c.json({ error: err.message || 'Internal error' }, 500);
});

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        // Dunning H-3/H-1 untuk subscription expiry
        runDunningCron(env).then((r) => {
          console.log('[cron dunning]', r);
        }),
        // Cleanup backup files > 30 hari
        cleanupExpiredBackups(env, 30).then((r) => {
          console.log('[cron cleanup-backups]', `deleted: ${r.deleted}, errors: ${r.errors}, cutoff: ${r.cutoffDate}`);
        }),
      ]),
    );
  },
};
