/**
 * Profitku Cloud API — Cloudflare Worker
 *
 * Kompatibel dengan path yang dipakai `src/lib/cloud-api.ts` di app:
 *  - GET  /api/plans
 *  - GET  /api/user/profile
 *  - POST /api/payments/checkout
 *  - POST /api/payments/verify/:id
 *  - GET  /api/payments/history
 *  - CRUD /api/stores...
 *  - backup + sync (stub / partial sampai R2 & Supabase full)
 *
 * Auth: Bearer token (Supabase access token, atau Google ID token di fase migrasi).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { SEED_PLANS } from './data/seed-plans';
import { getUserFromJwt, sbGet, sbPost, sbPatch, SupabaseError } from './lib/supabase';
import { sendEmail, sendPush, sendWhatsApp } from './lib/notify';
import {
  deleteBackupMeta,
  deleteBackupObject,
  fileKeyFor,
  getBackupMeta,
  getBackupObject,
  insertBackupMeta,
  listBackupMeta,
  putBackupObject,
  r2Configured,
  sumBackupBytes,
  cleanupExpiredBackups,
} from './lib/backups';
import { notifySubscriptionActivated, runDunningCron } from './lib/lifecycle';
import { exchangeGoogleIdToken } from './lib/auth-google';
import { CLOUD_PLAN_PRICE_IDR } from './data/seed-plans';
import adminRoutes from './routes/admin';
import { writeEvent } from './lib/admin';
import {
  createSnapTransaction,
  getTransactionStatus,
  isFailureStatus,
  isPaidStatus,
  isPendingStatus,
  midtransConfigured,
  verifyNotificationSignature,
} from './lib/midtrans';
import { fulfillCompletedPayment } from './lib/payments';
import {
  normalizeVoucherCode,
  resolveListPrice,
  validateVoucherForUser,
} from './lib/vouchers';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const origin = c.env.APP_ORIGIN || 'https://profitku.my.id';
  const adminOrigin = c.env.ADMIN_ORIGIN || 'https://dashboard.profitku.my.id';
  return cors({
    origin: [
      origin,
      adminOrigin,
      'http://localhost:8080',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'capacitor://localhost',
      'http://localhost',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

/** Auth middleware shared by /api/* and /admin/api/* */
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

  if (token && c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY) {
    const user = await getUserFromJwt(c.env, token);
    if (user) {
      c.set('userId', user.id);
      c.set('userEmail', user.email ?? null);
    }
  } else if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || '')) as {
        sub?: string;
        email?: string;
      };
      if (payload.sub) {
        c.set('userId', payload.sub);
        c.set('userEmail', payload.email ?? null);
      }
    } catch {
      /* ignore */
    }
  }

  await next();
}

app.use('/api/*', bearerAuth);
app.use('/admin/api/*', bearerAuth);

/** Staff admin console API */
app.route('/admin/api', adminRoutes);

function requireUser(c: {
  get: (k: 'userId' | 'userEmail' | 'bearer') => string | null;
  json: (b: unknown, s?: number) => Response;
}): string | Response {
  const id = c.get('userId');
  if (!id) return c.json({ error: 'Belum login' }, 401);
  return id;
}

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

/** Tukar Google ID token → sesi Supabase (fallback bila client signInWithIdToken gagal). */
app.post('/api/auth/google', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { idToken?: string };
  if (!body.idToken) return c.json({ error: 'idToken wajib' }, 400);
  const result = await exchangeGoogleIdToken(c.env, body.idToken);
  if ('error' in result) {
    const code = (result.status === 401 || result.status === 403 || result.status === 503
      ? result.status
      : 400) as 400 | 401 | 403 | 503;
    return c.json({ error: result.error }, code);
  }
  return c.json({ session: result.session });
});

// --- Plans ---
app.get('/api/plans', async (c) => {
  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type Row = {
        id: string;
        name: string;
        storage_limit_mb: number;
        price_idr: number;
        category: string;
        max_stores: number | null;
      };
      const rows = await sbGet<Row[]>(
        c.env,
        'plans?is_active=eq.true&order=sort_order.asc&select=id,name,storage_limit_mb,price_idr,category,max_stores',
      );
      const plans = rows.map((r) => ({
        id: r.id,
        name: r.name,
        storageLimitMb: r.storage_limit_mb,
        price: r.price_idr,
        category: r.category,
        maxStores: r.max_stores,
      }));
      return c.json({ plans });
    }
  } catch (err) {
    console.warn('[plans] supabase fallback seed', err);
  }
  return c.json({ plans: SEED_PLANS });
});

// --- Profile / entitlements ---
app.get('/api/user/profile', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  // Default free entitlements
  let profile = {
    user: {
      id: userId,
      email: c.get('userEmail') || '',
      name: c.get('userEmail')?.split('@')[0] || 'User',
      picture: undefined as string | undefined,
      planId: null as string | null,
      storageLimitMb: 0,
      syncExpiry: null as string | null,
      maxStores: null as number | null,
      createdAt: new Date().toISOString(),
    },
    subscription: null as null | Record<string, unknown>,
    syncSubscription: null as null | Record<string, unknown>,
    storageUsage: { usedMb: 0, limitMb: 0, remainingMb: 0 },
    backups: [] as unknown[],
  };

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type Ent = {
        user_id: string;
        email: string | null;
        name: string | null;
        picture: string | null;
        storage_limit_mb: number;
        has_sync: boolean;
        sync_expiry: string | null;
        max_stores: number | null;
        is_lifetime?: boolean | null;
      };
      const ents = await sbGet<Ent[]>(c.env, `user_entitlements?user_id=eq.${userId}&select=*`);
      const ent = ents[0];
      if (ent) {
        profile.user.email = ent.email || profile.user.email;
        profile.user.name = ent.name || profile.user.name;
        profile.user.picture = ent.picture || undefined;
        profile.user.storageLimitMb = ent.storage_limit_mb || 0;
        profile.user.syncExpiry = ent.sync_expiry;
        profile.user.maxStores = ent.max_stores;
        profile.storageUsage = {
          usedMb: 0,
          limitMb: ent.storage_limit_mb || 0,
          remainingMb: ent.storage_limit_mb || 0,
        };
      }

      type SubRow = {
        id: string;
        plan_id: string;
        status: string;
        current_period_start: string;
        current_period_end: string;
        is_lifetime?: boolean;
        plans: {
          id: string;
          name: string;
          storage_limit_mb: number;
          price_idr: number;
          category: string;
          max_stores: number | null;
        } | null;
      };

      const nowIso = new Date().toISOString();
      let subs: SubRow[] = [];
      try {
        subs = await sbGet<SubRow[]>(
          c.env,
          `subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&or=(is_lifetime.eq.true,current_period_end.gt.${nowIso})&select=id,plan_id,status,current_period_start,current_period_end,is_lifetime,plans(id,name,storage_limit_mb,price_idr,category,max_stores)`,
        );
      } catch {
        subs = await sbGet<SubRow[]>(
          c.env,
          `subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&current_period_end=gt.${nowIso}&select=id,plan_id,status,current_period_start,current_period_end,plans(id,name,storage_limit_mb,price_idr,category,max_stores)`,
        );
      }

      for (const s of subs) {
        const plan = s.plans
          ? {
              id: s.plans.id,
              name: s.plans.name,
              storageLimitMb: s.plans.storage_limit_mb,
              price: s.plans.price_idr,
              category: s.plans.category,
              maxStores: s.plans.max_stores,
            }
          : null;
        const mapped = {
          id: s.id,
          planId: s.plan_id,
          plan,
          startDate: s.current_period_start,
          endDate: s.current_period_end,
          status: s.status === 'active' || s.status === 'trialing' ? 'ACTIVE' : s.status.toUpperCase(),
          hasActiveSubscription: true,
          isLifetime: !!s.is_lifetime || !!ent?.is_lifetime,
        };
        if (plan?.category === 'SYNC') profile.syncSubscription = mapped;
        else if (plan?.category === 'STORAGE') profile.subscription = mapped;
        // cloud_monthly = SYNC; juga map ke subscription generik bila kosong
        if (plan?.category === 'SYNC' && !profile.subscription) {
          profile.subscription = mapped;
        }
      }

      type BackupRow = {
        id: string;
        file_name: string;
        file_size: number;
        created_at: string;
        updated_at: string;
      };
      const backups = await sbGet<BackupRow[]>(
        c.env,
        `backups?user_id=eq.${userId}&order=created_at.desc&limit=20&select=id,file_name,file_size,created_at,updated_at`,
      );
      profile.backups = backups.map((b) => ({
        id: b.id,
        fileName: b.file_name,
        fileSize: b.file_size,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      }));
    }
  } catch (err) {
    console.warn('[profile]', err);
  }

  return c.json(profile);
});

// --- Voucher preview (auth) ---
app.post('/api/vouchers/preview', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  const body = (await c.req.json().catch(() => ({}))) as { code?: string; planId?: string };
  const planId = body.planId || 'cloud_monthly';
  const code = body.code || '';
  if (!code.trim()) return c.json({ valid: false, error: 'Kode voucher wajib diisi' }, 400);

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ valid: false, error: 'Database belum dikonfigurasi' }, 503);
  }

  const { amount: listPrice } = await resolveListPrice(c.env, planId);
  const result = await validateVoucherForUser(c.env, {
    code,
    userId: String(userId),
    planId,
    listPrice,
  });
  if (!result.valid) return c.json(result, 200);
  return c.json(result);
});

// --- Checkout (mock | midtrans Snap | voucher gratis) ---
app.post('/api/payments/checkout', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  const body = (await c.req.json().catch(() => ({}))) as {
    planId?: string;
    mobile?: string;
    redirectURL?: string;
    voucherCode?: string;
  };
  if (!body.planId) return c.json({ error: 'planId wajib' }, 400);

  const plan = SEED_PLANS.find((p) => p.id === body.planId);
  let amount = plan?.price ?? 0;
  let planName = plan?.name ?? body.planId;
  let amountBefore = amount;

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      const priced = await resolveListPrice(c.env, body.planId);
      amount = priced.amount;
      planName = priced.planName;
      amountBefore = amount;
    }
  } catch {
    /* seed price */
  }

  let voucherMeta: {
    voucherId: string;
    voucherCode: string;
    voucherType: string;
    voucherValue: number;
    amountBefore: number;
    grantDays: number | null;
    isLifetime: boolean;
  } | null = null;

  const rawCode = (body.voucherCode || '').trim();
  if (rawCode) {
    if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
      return c.json({ error: 'Voucher membutuhkan database' }, 503);
    }
    const preview = await validateVoucherForUser(c.env, {
      code: rawCode,
      userId: String(userId),
      planId: body.planId,
      listPrice: amountBefore,
    });
    if (!preview.valid) {
      return c.json({ error: preview.error }, 400);
    }
    amount = preview.amountAfter;
    voucherMeta = {
      voucherId: preview.voucherId,
      voucherCode: preview.code,
      voucherType: preview.type,
      voucherValue: preview.value,
      amountBefore: preview.amountBefore,
      grantDays: preview.grantDays,
      isLifetime: preview.isLifetime,
    };
  }

  const paymentId = crypto.randomUUID();
  let provider = (c.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

  let cloudReturn = 'https://profitku.my.id/settings/cloud';
  try {
    const raw = (body.redirectURL || c.env.APP_ORIGIN || 'https://profitku.my.id').trim();
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    cloudReturn = `${u.origin}/settings/cloud`;
  } catch {
    /* keep default */
  }
  const finishUrl = `${cloudReturn}?pending=${paymentId}`;

  let paymentLink: string | null = `${cloudReturn}?pending=${paymentId}`;
  let snapToken: string | null = null;
  let completedImmediately = false;

  // Amount 0: skip gateway, fulfill langsung (voucher free / 100% / lifetime)
  if (amount <= 0) {
    provider = voucherMeta ? 'voucher' : 'comp';
    paymentLink = null;
    try {
      if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
        await sbPost(c.env, 'payments', {
          id: paymentId,
          user_id: userId,
          plan_id: body.planId,
          amount: 0,
          status: 'PENDING',
          provider,
          payment_link: null,
          provider_ref: paymentId,
          raw: {
            mobile: body.mobile ?? null,
            redirectURL: body.redirectURL ?? null,
            ...(voucherMeta || {}),
          },
        });
        await fulfillCompletedPayment(c.env, {
          paymentId,
          userId: String(userId),
          userEmail: c.get('userEmail'),
          provider,
          providerRef: voucherMeta?.voucherCode || paymentId,
        });
        completedImmediately = true;
      } else {
        return c.json({ error: 'Database belum dikonfigurasi untuk voucher gratis' }, 503);
      }
    } catch (err) {
      console.error('[checkout free]', err);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal mengaktifkan langganan gratis' },
        500,
      );
    }

    return c.json({
      message: voucherMeta?.isLifetime
        ? 'Cloud seumur hidup diaktifkan'
        : `Checkout ${planName} (gratis)`,
      paymentLink: null,
      snapToken: null,
      completed: true,
      transaction: {
        id: paymentId,
        status: 'COMPLETED',
        planId: body.planId,
        amount: 0,
        provider,
        voucherCode: voucherMeta?.voucherCode ?? null,
      },
    });
  }

  if (provider === 'mock') {
    paymentLink = `${cloudReturn}?mock_pay=${paymentId}&plan=${body.planId}`;
  } else if (provider === 'midtrans') {
    if (!midtransConfigured(c.env)) {
      return c.json({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' }, 503);
    }
    try {
      const snap = await createSnapTransaction(c.env, {
        orderId: paymentId,
        amount,
        planName: voucherMeta
          ? `${planName} (${normalizeVoucherCode(voucherMeta.voucherCode)})`
          : planName,
        customerEmail: c.get('userEmail'),
        customerName: c.get('userEmail')?.split('@')[0] || 'Profitku',
        finishUrl,
      });
      paymentLink = snap.redirectUrl;
      snapToken = snap.token;
    } catch (err) {
      console.error('[checkout midtrans]', err);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi Midtrans' },
        502,
      );
    }
  } else if (provider === 'xendit') {
    return c.json({ error: 'Xendit belum diaktifkan — set PAYMENT_PROVIDER=midtrans|mock' }, 501);
  }

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      await sbPost(c.env, 'payments', {
        id: paymentId,
        user_id: userId,
        plan_id: body.planId,
        amount,
        status: 'PENDING',
        provider,
        payment_link: paymentLink,
        provider_ref: paymentId,
        raw: {
          mobile: body.mobile ?? null,
          redirectURL: body.redirectURL ?? null,
          snapToken,
          finishUrl,
          ...(voucherMeta || {}),
        },
      });
    }
  } catch (err) {
    console.warn('[checkout] persist payment', err);
  }

  return c.json({
    message: `Checkout ${planName}`,
    paymentLink,
    snapToken,
    completed: completedImmediately,
    transaction: {
      id: paymentId,
      status: 'PENDING',
      planId: body.planId,
      amount,
      provider,
      voucherCode: voucherMeta?.voucherCode ?? null,
    },
  });
});

app.post('/api/payments/verify/:id', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id');
  const provider = (c.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

  try {
    if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Tanpa DB: mock saja
      if (provider !== 'mock') {
        return c.json({ error: 'Database belum dikonfigurasi' }, 503);
      }
      const start = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + 30);
      await notifySubscriptionActivated(c.env, {
        userId: String(userId),
        email: c.get('userEmail'),
        phone: null,
        planName: 'Profitku Cloud',
        amount: CLOUD_PLAN_PRICE_IDR,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        paymentId: id,
      });
      return c.json({
        message: 'Pembayaran terverifikasi (mock, no DB)',
        transaction: { id, status: 'COMPLETED' },
      });
    }

    type Pay = { id: string; plan_id: string; status: string; user_id: string; amount: number };
    const pays = await sbGet<Pay[]>(
      c.env,
      `payments?id=eq.${id}&user_id=eq.${userId}&select=id,plan_id,status,user_id,amount`,
    );
    const pay = pays[0];
    if (!pay) return c.json({ error: 'Transaksi tidak ditemukan' }, 404);

    if (pay.status === 'COMPLETED') {
      return c.json({
        message: 'Pembayaran sudah aktif',
        transaction: { id, status: 'COMPLETED' },
      });
    }

    if (provider === 'midtrans') {
      if (!midtransConfigured(c.env)) {
        return c.json({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' }, 503);
      }
      const st = await getTransactionStatus(c.env, id);
      if (isPaidStatus(st.transactionStatus, st.fraudStatus)) {
        await fulfillCompletedPayment(c.env, {
          paymentId: id,
          userId: String(userId),
          userEmail: c.get('userEmail'),
          provider: 'midtrans',
          providerRef: st.orderId,
          midtransRaw: st.raw,
        });
        return c.json({
          message: 'Pembayaran terverifikasi',
          transaction: { id, status: 'COMPLETED' },
          midtransStatus: st.transactionStatus,
        });
      }
      if (isFailureStatus(st.transactionStatus)) {
        await sbPatch(c.env, `payments?id=eq.${id}`, {
          status: 'FAILED',
          raw: { midtrans: st.raw },
        });
        return c.json({
          message: 'Pembayaran gagal / dibatalkan',
          transaction: { id, status: 'FAILED' },
          midtransStatus: st.transactionStatus,
        });
      }
      return c.json({
        message: 'Menunggu pembayaran',
        transaction: { id, status: 'PENDING' },
        midtransStatus: st.transactionStatus,
      });
    }

    // mock: auto complete
    await fulfillCompletedPayment(c.env, {
      paymentId: id,
      userId: String(userId),
      userEmail: c.get('userEmail'),
      provider: 'mock',
      providerRef: id,
    });
    return c.json({
      message: 'Pembayaran terverifikasi',
      transaction: { id, status: 'COMPLETED' },
    });
  } catch (err) {
    console.warn('[verify]', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Verifikasi gagal' },
      500,
    );
  }
});

app.get('/api/payments/history', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type Row = {
        id: string;
        plan_id: string;
        amount: number;
        status: string;
        provider_ref: string | null;
        created_at: string;
        updated_at: string;
      };
      const rows = await sbGet<Row[]>(
        c.env,
        `payments?user_id=eq.${userId}&order=created_at.desc&limit=50&select=*`,
      );
      const history = rows.map((r) => ({
        id: r.id,
        planId: r.plan_id,
        amount: r.amount,
        status: r.status,
        paymentGatewayRef: r.provider_ref ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      return c.json({
        history,
        pagination: {
          page: 1,
          limit: 50,
          totalItems: history.length,
          totalPages: 1,
          hasMore: false,
        },
      });
    }
  } catch (err) {
    console.warn('[history]', err);
  }

  return c.json({
    history: [],
    pagination: { page: 1, limit: 50, totalItems: 0, totalPages: 1, hasMore: false },
  });
});

// Google Play verify — stub (isi dengan Google Play Developer API)
app.post('/api/payments/google-play/verify', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    planId?: string;
    productId?: string;
    purchaseToken?: string;
    packageName?: string;
  };
  if (!body.planId || !body.purchaseToken) {
    return c.json({ error: 'planId dan purchaseToken wajib' }, 400);
  }

  const end = new Date();
  end.setDate(end.getDate() + 30);

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      await sbPost(c.env, 'subscriptions', {
        user_id: userId,
        plan_id: body.planId,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: end.toISOString(),
        provider: 'google_play',
        provider_ref: body.purchaseToken.slice(0, 64),
      });
    }
  } catch (err) {
    console.warn('[google-play]', err);
  }

  return c.json({
    message: 'Pembelian Play diverifikasi',
    subscription: {
      planId: body.planId,
      status: 'ACTIVE',
      expiryDate: end.toISOString(),
    },
  });
});

// --- Stores (minimal) ---
app.get('/api/stores', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type S = {
        id: string;
        user_id: string;
        name: string;
        created_at: string;
        updated_at: string;
        is_public: boolean;
        identifier: string | null;
      };
      const rows = await sbGet<S[]>(c.env, `stores?user_id=eq.${userId}&order=created_at.desc&select=*`);
      return c.json({
        stores: rows.map((s) => ({
          id: s.id,
          userId: s.user_id,
          name: s.name,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
          isPublic: s.is_public,
          identifier: s.identifier,
        })),
      });
    }
  } catch (err) {
    console.warn('[stores]', err);
  }
  return c.json({ stores: [] });
});

app.post('/api/stores', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return c.json({ error: 'Nama toko wajib' }, 400);

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type S = {
        id: string;
        user_id: string;
        name: string;
        created_at: string;
        updated_at: string;
      };
      const rows = await sbPost<S[]>(c.env, 'stores', {
        user_id: userId,
        name: body.name.trim(),
      });
      const s = rows[0];
      return c.json({
        store: {
          id: s.id,
          userId: s.user_id,
          name: s.name,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        },
      });
    }
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return c.json({
    store: { id, userId: userId, name: body.name.trim(), createdAt: now, updatedAt: now },
  });
});

// Sync stub — terima payload, log, OK (full sync di fase berikutnya)
app.post('/api/stores/:storeId/sync', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('storeId');
  const payload = await c.req.json().catch(() => ({}));
  const keys = typeof payload === 'object' && payload ? Object.keys(payload as object) : [];
  console.log(`[sync] user=${userId} store=${storeId} keys=${keys.join(',')}`);
  return c.json({ message: 'Sinkronisasi diterima (fase 1 — metadata only)' });
});

// --- Backups (R2 + metadata Supabase) ---
app.get('/api/backups', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    const rows = await listBackupMeta(c.env, String(userId), 50);
    const backups = rows.map((b) => ({
      id: b.id,
      fileName: b.file_name,
      fileSize: b.file_size,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
    return c.json({
      backups,
      pagination: {
        page: 1,
        limit: 50,
        totalItems: backups.length,
        totalPages: 1,
        hasMore: false,
      },
    });
  } catch (err) {
    console.warn('[backups list]', err);
    return c.json({
      backups: [],
      pagination: { page: 1, limit: 50, totalItems: 0, totalPages: 1, hasMore: false },
    });
  }
});

app.post('/api/backups', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  if (!r2Configured(c.env)) {
    return c.json(
      { error: 'R2 belum dikonfigurasi. Binding BACKUP_BUCKET wajib di wrangler.toml / dashboard.' },
      503,
    );
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Supabase wajib untuk menyimpan metadata backup.' }, 503);
  }

  // Gate: butuh langganan cloud aktif (atau dev mock tanpa entitlements)
  try {
    type Ent = { storage_limit_mb: number; has_sync: boolean };
    const ents = await sbGet<Ent[]>(
      c.env,
      `user_entitlements?user_id=eq.${userId}&select=storage_limit_mb,has_sync`,
    );
    const ent = ents[0];
    const limitMb = ent?.storage_limit_mb ?? 0;
    const hasCloud = ent?.has_sync || limitMb > 0;
    if (!hasCloud && (c.env.PAYMENT_PROVIDER || 'mock') !== 'mock') {
      return c.json({ error: 'Langganan Profitku Cloud diperlukan untuk backup cloud.' }, 403);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    const storeIdRaw = form.get('storeId');
    const storeId =
      typeof storeIdRaw === 'string' && storeIdRaw.trim() ? storeIdRaw.trim() : null;

    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return c.json({ error: 'File backup wajib (field: file)' }, 400);
    }

    const blob = file as Blob & { name?: string };
    const fileName =
      (typeof blob.name === 'string' && blob.name) ||
      (typeof form.get('fileName') === 'string' ? String(form.get('fileName')) : 'backup.json');
    const buf = await blob.arrayBuffer();
    const fileSize = buf.byteLength;
    if (fileSize <= 0) return c.json({ error: 'File kosong' }, 400);
    if (fileSize > 50 * 1024 * 1024) {
      return c.json({ error: 'Ukuran backup maksimal 50 MB' }, 400);
    }

    // Kuota storage (default 2 GB bila mock tanpa ent)
    const limitBytes = (limitMb > 0 ? limitMb : 2048) * 1024 * 1024;
    const used = await sumBackupBytes(c.env, String(userId));
    if (used + fileSize > limitBytes) {
      return c.json(
        {
          error: `Kuota backup penuh (${Math.round(used / 1024 / 1024)} / ${Math.round(limitBytes / 1024 / 1024)} MB). Hapus backup lama dulu.`,
        },
        413,
      );
    }

    const id = crypto.randomUUID();
    const key = fileKeyFor(String(userId), fileName);
    await putBackupObject(c.env, key, buf);
    const meta = await insertBackupMeta(c.env, {
      id,
      user_id: String(userId),
      store_id: storeId,
      file_name: fileName,
      file_key: key,
      file_size: fileSize,
    });

    return c.json({
      backup: {
        id: meta.id,
        fileName: meta.file_name,
        fileSize: meta.file_size,
        createdAt: meta.created_at,
        updatedAt: meta.updated_at,
      },
    });
  } catch (err) {
    console.error('[backup upload]', err);
    const msg = err instanceof Error ? err.message : 'Upload gagal';
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/backups/:id/download', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id');

  try {
    const meta = await getBackupMeta(c.env, id, String(userId));
    if (!meta) return c.json({ error: 'Backup tidak ditemukan' }, 404);
    const obj = await getBackupObject(c.env, meta.file_key);
    if (!obj) return c.json({ error: 'File backup tidak ada di storage' }, 404);
    const text = await obj.text();
    try {
      const json = JSON.parse(text);
      return c.json(json);
    } catch {
      return new Response(text, {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('[backup download]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Download gagal' }, 500);
  }
});

app.delete('/api/backups/:id', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id');

  try {
    const meta = await getBackupMeta(c.env, id, String(userId));
    if (!meta) return c.json({ error: 'Backup tidak ditemukan' }, 404);
    await deleteBackupObject(c.env, meta.file_key);
    await deleteBackupMeta(c.env, id, String(userId));
    return c.json({ ok: true });
  } catch (err) {
    console.error('[backup delete]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Hapus gagal' }, 500);
  }
});

/** Cron manual / admin: jalankan dunning sekarang */
app.post('/api/cron/dunning', async (c) => {
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const hdr = c.req.header('x-cron-secret') || c.req.header('x-webhook-secret');
    if (hdr !== secret) return c.json({ error: 'Unauthorized' }, 401);
  } else if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock') {
    return c.json({ error: 'WEBHOOK_SECRET wajib di production' }, 403);
  }
  const result = await runDunningCron(c.env);
  return c.json({ ok: true, ...result });
});

/** Cron manual / admin: cleanup backup expired */
app.post('/api/cron/cleanup-backups', async (c) => {
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const hdr = c.req.header('x-cron-secret') || c.req.header('x-webhook-secret');
    if (hdr !== secret) return c.json({ error: 'Unauthorized' }, 401);
  } else if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock') {
    return c.json({ error: 'WEBHOOK_SECRET wajib di production' }, 403);
  }
  const result = await cleanupExpiredBackups(c.env, 30);
  return c.json({ ok: true, ...result });
});

// Webhooks internal
app.get('/webhook/latest-version', (c) => {
  // Fire-and-forget ping dari client — cukup 204
  return c.body(null, 204);
});

app.post('/webhook/issue-report', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  console.log('[issue-report]', JSON.stringify(body).slice(0, 2000));
  // Opsional: forward ke email support
  if (c.env.RESEND_API_KEY) {
    await sendEmail(c.env, {
      to: 'support@profitku.my.id',
      subject: '[Profitku] Issue report',
      html: `<pre>${JSON.stringify(body, null, 2).slice(0, 8000)}</pre>`,
    });
  }
  return c.json({ ok: true });
});

app.post('/webhook/user-type', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  console.log('[user-type]', body);
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

// Test notify (lindungi di production)
app.post('/api/dev/notify-test', async (c) => {
  if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock') {
    return c.json({ error: 'Hanya tersedia di mode mock' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    phone?: string;
    /** Supabase user id — External ID OneSignal */
    userId?: string;
  };
  const results: Record<string, unknown> = {};
  if (body.email) {
    results.email = await sendEmail(c.env, {
      to: body.email,
      subject: 'Tes notifikasi Profitku',
      html: '<p>Email Resend OK.</p>',
    });
  }
  if (body.phone) {
    results.wa = await sendWhatsApp(c.env, {
      target: body.phone,
      message: 'Tes notifikasi WhatsApp Profitku (Fonnte).',
    });
  }
  if (body.userId) {
    results.push = await sendPush(c.env, {
      externalUserId: body.userId,
      title: 'Tes Profitku',
      body: 'Push OneSignal OK — notifikasi sampai di perangkat.',
      url: 'https://profitku.my.id/settings/cloud',
      data: { type: 'dev_test' },
    });
  }
  return c.json({ results });
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
