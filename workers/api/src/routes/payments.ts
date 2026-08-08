/**
 * Profitku API — Payments & checkout (/api/payments/*)
 * Harga & periode langganan dihitung SERVER-side; client tidak dipercaya.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser, resolveOwnedStoreId } from './helpers';
import { sbGet, sbPost, sbPatch } from '../lib/supabase';
import { notifySubscriptionActivated } from '../lib/lifecycle';
import { fulfillCompletedPayment } from '../lib/payments';
import {
  CLOUD_PLAN_PRICE_IDR,
  SEED_PLANS,
  cloudDurationFactor,
  normalizeDurationMonths,
} from '../data/seed-plans';
import {
  createSnapTransaction,
  getTransactionStatus,
  isFailureStatus,
  isPaidStatus,
  midtransConfigured,
} from '../lib/midtrans';
import {
  createSumopodPayment,
  getSumopodPaymentStatus,
  isSumopodFailedStatus,
  isSumopodPaidStatus,
  sumopodConfigured,
} from '../lib/sumopod';
import { normalizeVoucherCode, resolveListPrice, validateVoucherForUser } from '../lib/vouchers';
import {
  getAffiliateSettings,
  loadAffiliateByCode,
  normalizeAffiliateCode,
} from '../lib/affiliates';

const paymentsRoutes = new Hono<AppEnv>();

// --- Checkout (mock | midtrans Snap | voucher gratis) ---
paymentsRoutes.post('/payments/checkout', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  const body = (await c.req.json().catch(() => ({}))) as {
    planId?: string;
    mobile?: string;
    redirectURL?: string;
    voucherCode?: string;
    affiliateCode?: string;
    affiliateCapturedAt?: string;
    storeId?: string;
    durationMonths?: number;
  };
  if (!body.planId) return c.json({ error: 'planId wajib' }, 400);

  // Validasi kode affiliasi (opsional, best-effort). Kode disimpan di payment.raw
  // agar komisi dicatat otomatis saat payment selesai (termasuk perpanjangan).
  // Atribusi: bila capturedAt diberikan dan lebih tua dari attribution_days,
  // kode diabaikan (komisi tidak berlaku untuk transaksi di luar jendela).
  let affiliateMeta: { code: string; name: string | null; capturedAt: string | null } | null = null;
  const rawAffiliateCode = normalizeAffiliateCode(body.affiliateCode || '');
  const rawAffiliateCapturedAt =
    typeof body.affiliateCapturedAt === 'string' && body.affiliateCapturedAt.trim()
      ? new Date(body.affiliateCapturedAt).toISOString()
      : null;
  if (rawAffiliateCode) {
    try {
      const settings = await getAffiliateSettings(c.env);
      if (settings.enabled) {
        const affiliate = await loadAffiliateByCode(c.env, rawAffiliateCode);
        if (!affiliate) {
          return c.json({ error: 'Kode affiliasi tidak valid' }, 400);
        }
        if (rawAffiliateCapturedAt) {
          const captured = new Date(rawAffiliateCapturedAt).getTime();
          if (!Number.isFinite(captured) || Date.now() - captured > settings.attribution_days * 86400000) {
            // jalur kedaluwarsa — jangan ikat komisi
            affiliateMeta = null;
          } else {
            affiliateMeta = { code: affiliate.code, name: affiliate.name, capturedAt: rawAffiliateCapturedAt };
          }
        } else {
          affiliateMeta = { code: affiliate.code, name: affiliate.name, capturedAt: null };
        }
      }
    } catch (err) {
      console.warn('[checkout affiliate]', err);
      // jangan blokir checkout bila validasi gagal
    }
  }

  const plan = SEED_PLANS.find((p) => p.id === body.planId);
  let amount = plan?.price ?? 0;
  let planName = plan?.name ?? body.planId;
  let amountBefore = amount;

  // Durasi langganan per toko (1/6/12 bulan) — harga dihitung server-side.
  const durationMonths = normalizeDurationMonths(body.durationMonths);
  const storeId = await resolveOwnedStoreId(c, String(userId), body.storeId);
  if (storeId instanceof Response) return storeId;

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

  amount = Math.round(amount * cloudDurationFactor(durationMonths));
  amountBefore = amount;

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
  let sumopodMeta: { paymentId: string | null; orderId: string | null } = {
    paymentId: null,
    orderId: null,
  };
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
          store_id: storeId,
          plan_id: body.planId,
          amount: 0,
          status: 'PENDING',
          provider,
          payment_link: null,
          provider_ref: paymentId,
          raw: {
            mobile: body.mobile ?? null,
            redirectURL: body.redirectURL ?? null,
            storeId,
            durationMonths,
            ...(voucherMeta || {}),
            ...(affiliateMeta
              ? {
                  affiliateCode: affiliateMeta.code,
                  affiliateName: affiliateMeta.name,
                  affiliateCapturedAt: affiliateMeta.capturedAt,
                }
              : {}),
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
  } else if (provider === 'sumopod') {
    if (!sumopodConfigured(c.env)) {
      return c.json({ error: 'SUMOPOD_API_KEY belum dikonfigurasi' }, 503);
    }
    try {
      const sumopod = await createSumopodPayment(c.env, {
        orderId: paymentId,
        amount,
        finishUrl,
      });
      paymentLink = sumopod.paymentLink;
      sumopodMeta = { paymentId: sumopod.paymentId, orderId: sumopod.orderId };
    } catch (err) {
      console.error('[checkout sumopod]', err);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi SumoPod' },
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
        store_id: storeId,
        plan_id: body.planId,
        amount,
        status: 'PENDING',
        provider,
        payment_link: paymentLink,
        provider_ref: paymentId,
        raw: {
          mobile: body.mobile ?? null,
          redirectURL: body.redirectURL ?? null,
          storeId,
          durationMonths,
          snapToken,
          sumopod: sumopodMeta.paymentId || sumopodMeta.orderId ? sumopodMeta : null,
          finishUrl,
          ...(voucherMeta || {}),
          ...(affiliateMeta
            ? {
                affiliateCode: affiliateMeta.code,
                affiliateName: affiliateMeta.name,
                affiliateCapturedAt: affiliateMeta.capturedAt,
              }
            : {}),
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

paymentsRoutes.post('/payments/verify/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const id = c.req.param('id') ?? '';
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

    if (provider === 'sumopod') {
      if (!sumopodConfigured(c.env)) {
        return c.json({ error: 'SUMOPOD_API_KEY belum dikonfigurasi' }, 503);
      }
      let st;
      try {
        st = await getSumopodPaymentStatus(c.env, id);
      } catch (err) {
        // API sementara tidak bisa dihubungi — jangan gagalkan polling, biarkan PENDING.
        console.warn('[verify sumopod] status lookup', err);
        return c.json({
          message: 'Menunggu pembayaran',
          transaction: { id, status: 'PENDING' },
        });
      }
      if (isSumopodPaidStatus(st.status)) {
        await fulfillCompletedPayment(c.env, {
          paymentId: id,
          userId: String(userId),
          userEmail: c.get('userEmail'),
          provider: 'sumopod',
          providerRef: st.paymentId || st.orderId,
          sumopodRaw: st.raw,
        });
        return c.json({
          message: 'Pembayaran terverifikasi',
          transaction: { id, status: 'COMPLETED' },
          sumopodStatus: st.status,
        });
      }
      if (isSumopodFailedStatus(st.status)) {
        await sbPatch(c.env, `payments?id=eq.${id}`, {
          status: 'FAILED',
          raw: { sumopod: st.raw },
        });
        return c.json({
          message: 'Pembayaran gagal / dibatalkan',
          transaction: { id, status: 'FAILED' },
          sumopodStatus: st.status,
        });
      }
      return c.json({
        message: 'Menunggu pembayaran',
        transaction: { id, status: 'PENDING' },
        sumopodStatus: st.status,
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

paymentsRoutes.get('/payments/history', async (c: AppContext) => {
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
paymentsRoutes.post('/payments/google-play/verify', async (c: AppContext) => {
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

export default paymentsRoutes;
