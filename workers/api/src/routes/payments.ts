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
  CLOUD_PLAN_ID,
  CLOUD_PLAN_PRICE_IDR,
  SEED_PLANS,
  normalizeDurationMonths,
} from '../data/seed-plans';
import { cloudDurationFactor } from '../lib/cloud-config';
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
  loadAffiliateById,
  loadAffiliateByUserId,
  normalizeAffiliateCode,
} from '../lib/affiliates';

const paymentsRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (body.planId !== CLOUD_PLAN_ID) {
    return c.json({ error: 'Plan cloud tidak valid' }, 400);
  }
  const requestedStoreId = body.storeId?.trim() || '';
  if (!requestedStoreId || !UUID_RE.test(requestedStoreId)) {
    return c.json({ error: 'storeId toko cloud wajib dan harus berupa UUID' }, 400);
  }

  // Validasi kode affiliasi (opsional, best-effort). Kode disimpan di payment.raw
  // agar komisi dicatat otomatis saat payment selesai (termasuk perpanjangan).
  // Atribusi: bila capturedAt diberikan dan lebih tua dari attribution_days,
  // kode diabaikan (komisi tidak berlaku untuk transaksi di luar jendela).
  let affiliateMeta: { code: string; name: string | null; capturedAt: string | null } | null = null;

  // 1) Kunci server-side (hasil OAuth dari link ?ref=KODE): user punya affiliate
  //    row dengan referred_by → komisi ke pengundang, permanen & lintas perangkat.
  //    Client (localStorage) tidak bisa menimpa kunci ini.
  try {
    const locked = await loadAffiliateByUserId(c.env, String(userId));
    if (locked?.referred_by) {
      const parent = await loadAffiliateById(c.env, locked.referred_by);
      if (parent && parent.is_active) {
        affiliateMeta = { code: parent.code, name: parent.name, capturedAt: null };
      }
    }
  } catch (err) {
    console.warn('[checkout affiliate lock]', err);
  }

  // 2) Fallback: kode dari client (localStorage, jendela attribution_days).
  const rawAffiliateCode = normalizeAffiliateCode(body.affiliateCode || '');
  let rawAffiliateCapturedAt: string | null = null;
  if (typeof body.affiliateCapturedAt === 'string' && body.affiliateCapturedAt.trim()) {
    const capturedAt = new Date(body.affiliateCapturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      return c.json({ error: 'affiliateCapturedAt tidak valid' }, 400);
    }
    rawAffiliateCapturedAt = capturedAt.toISOString();
  }
  if (!affiliateMeta && rawAffiliateCode) {
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
  const storeId = await resolveOwnedStoreId(c, String(userId), requestedStoreId);
  if (storeId instanceof Response) return storeId;

  if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const priced = await resolveListPrice(c.env, body.planId);
      if (!priced.active || priced.category !== 'SYNC') {
        return c.json({ error: 'Plan cloud tidak aktif' }, 400);
      }
      amount = priced.amount;
      planName = priced.planName;
      amountBefore = amount;
    } catch (err) {
      console.error('[checkout] resolve plan', err);
      return c.json({ error: 'Gagal memvalidasi plan cloud' }, 503);
    }
  }

  amount = Math.round(amount * (await cloudDurationFactor(c.env, durationMonths)));
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

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Database wajib untuk checkout cloud per toko' }, 503);
  }

  if (!['mock', 'midtrans', 'sumopod'].includes(provider)) {
    return c.json({ error: 'Payment provider belum diaktifkan' }, 501);
  }
  if (provider === 'midtrans' && !midtransConfigured(c.env)) {
    return c.json({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' }, 503);
  }
  if (provider === 'sumopod' && !sumopodConfigured(c.env)) {
    return c.json({ error: 'SUMOPOD_API_KEY belum dikonfigurasi' }, 503);
  }
  // BILL-006: mock = entitlement gratis via /payments/verify — dilarang di production.
  if (provider === 'mock' && c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Payment provider mock tidak diizinkan di production' }, 503);
  }

  const basePaymentRaw = {
    mobile: body.mobile ?? null,
    redirectURL: body.redirectURL ?? null,
    storeId,
    durationMonths,
    finishUrl,
    ...(voucherMeta || {}),
    ...(affiliateMeta
      ? {
          affiliateCode: affiliateMeta.code,
          affiliateName: affiliateMeta.name,
          affiliateCapturedAt: affiliateMeta.capturedAt,
        }
      : {}),
  };

  // Persist the internal payment before creating an external gateway payment.
  // This prevents a paid gateway transaction from becoming an unknown order.
  try {
    await sbPost(c.env, 'payments', {
      id: paymentId,
      user_id: userId,
      store_id: storeId,
      plan_id: body.planId,
      amount,
      status: 'PENDING',
      provider,
      payment_link: null,
      provider_ref: paymentId,
      raw: basePaymentRaw,
    });
  } catch (err) {
    console.error('[checkout] persist payment before gateway', err);
    return c.json({ error: 'Gagal menyiapkan transaksi pembayaran' }, 503);
  }

  if (provider === 'mock') {
    paymentLink = `${cloudReturn}?mock_pay=${paymentId}&plan=${body.planId}`;
  } else if (provider === 'midtrans') {
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
      await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
        status: 'FAILED',
        raw: { ...basePaymentRaw, providerError: err instanceof Error ? err.message : 'gateway_error' },
      }).catch(() => undefined);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi Midtrans' },
        502,
      );
    }
  } else if (provider === 'sumopod') {
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
      await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
        status: 'FAILED',
        raw: { ...basePaymentRaw, providerError: err instanceof Error ? err.message : 'gateway_error' },
      }).catch(() => undefined);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi SumoPod' },
        502,
      );
    }
  }

  try {
    await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
      payment_link: paymentLink,
      raw: {
        ...basePaymentRaw,
        snapToken,
        sumopod: sumopodMeta.paymentId || sumopodMeta.orderId ? sumopodMeta : null,
      },
    });
  } catch (err) {
    console.error('[checkout] finalize payment setup', err);
    return c.json({ error: 'Transaksi dibuat tetapi gagal menyimpan detail gateway' }, 503);
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

/**
 * Checkout batch (Daftar Toko): satu pembayaran untuk beberapa toko
 * (upgrade + perpanjang). Harga tetap dihitung SERVER-side.
 */
paymentsRoutes.post('/payments/checkout-batch', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  const body = (await c.req.json().catch(() => ({}))) as {
    items?: { storeId?: string; action?: string; durationMonths?: number }[];
    redirectURL?: string;
    voucherCode?: string;
    affiliateCode?: string;
    affiliateCapturedAt?: string;
  };

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 10) : [];
  if (rawItems.length === 0) {
    return c.json({ error: 'items wajib (pilih minimal 1 toko)' }, 400);
  }
  const items: { storeId: string; action: 'subscribe' | 'renew'; durationMonths: 1 | 6 | 12 }[] = [];
  for (const it of rawItems) {
    const storeId = it.storeId?.trim() || '';
    if (!storeId || !UUID_RE.test(storeId)) {
      return c.json({ error: 'storeId toko cloud wajib dan harus berupa UUID' }, 400);
    }
    const action = it.action === 'renew' ? 'renew' : 'subscribe';
    const durationMonths = normalizeDurationMonths(it.durationMonths);
    items.push({ storeId, action, durationMonths });
  }

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Database wajib untuk checkout cloud per toko' }, 503);
  }

  // Affiliasi: kunci server-side dulu, fallback kode client (sama dengan checkout tunggal).
  let affiliateMeta: { code: string; name: string | null; capturedAt: string | null } | null = null;
  try {
    const locked = await loadAffiliateByUserId(c.env, String(userId));
    if (locked?.referred_by) {
      const parent = await loadAffiliateById(c.env, locked.referred_by);
      if (parent && parent.is_active) {
        affiliateMeta = { code: parent.code, name: parent.name, capturedAt: null };
      }
    }
  } catch (err) {
    console.warn('[checkout-batch affiliate lock]', err);
  }
  const rawAffiliateCode = normalizeAffiliateCode(body.affiliateCode || '');
  let rawAffiliateCapturedAt: string | null = null;
  if (typeof body.affiliateCapturedAt === 'string' && body.affiliateCapturedAt.trim()) {
    const capturedAt = new Date(body.affiliateCapturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      return c.json({ error: 'affiliateCapturedAt tidak valid' }, 400);
    }
    rawAffiliateCapturedAt = capturedAt.toISOString();
  }
  if (!affiliateMeta && rawAffiliateCode) {
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
            affiliateMeta = null;
          } else {
            affiliateMeta = { code: affiliate.code, name: affiliate.name, capturedAt: rawAffiliateCapturedAt };
          }
        } else {
          affiliateMeta = { code: affiliate.code, name: affiliate.name, capturedAt: null };
        }
      }
    } catch (err) {
      console.warn('[checkout-batch affiliate]', err);
    }
  }

  // Kepemilikan semua toko.
  const idList = items.map((i) => i.storeId).join(',');
  const owned = await sbGet<{ id: string }[]>(
    c.env,
    `stores?id=in.(${idList})&user_id=eq.${userId}&select=id`,
  );
  const ownedIds = new Set(owned.map((s) => s.id));
  if (ownedIds.size !== items.length) {
    return c.json({ error: 'Salah satu toko tidak ditemukan atau bukan milik Anda' }, 400);
  }

  // Aksi valid: subscribe = belum ada langganan aktif; renew = sudah ada.
  const subs = await sbGet<{ store_id: string }[]>(
    c.env,
    `subscriptions?user_id=eq.${userId}&store_id=in.(${idList})&status=in.(active,trialing)&select=store_id`,
  );
  const activeStoreIds = new Set(subs.map((s) => s.store_id));
  for (const it of items) {
    if (it.action === 'renew' && !activeStoreIds.has(it.storeId)) {
      return c.json({ error: 'Toko tidak memiliki langganan aktif untuk diperpanjang' }, 400);
    }
    if (it.action === 'subscribe' && activeStoreIds.has(it.storeId)) {
      return c.json({ error: 'Salah satu toko sudah memiliki langganan aktif' }, 400);
    }
  }

  // Harga server-side: total = Σ harga bulanan × faktor durasi per toko.
  const priced = await resolveListPrice(c.env, CLOUD_PLAN_ID);
  if (!priced.active || priced.category !== 'SYNC') {
    return c.json({ error: 'Plan cloud tidak aktif' }, 400);
  }
  let amount = 0;
  for (const it of items) {
    amount += Math.round(priced.amount * (await cloudDurationFactor(c.env, it.durationMonths)));
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
    const preview = await validateVoucherForUser(c.env, {
      code: rawCode,
      userId: String(userId),
      planId: CLOUD_PLAN_ID,
      listPrice: amount,
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

  let cloudReturn = 'https://profitku.my.id/settings/stores';
  try {
    const raw = (body.redirectURL || c.env.APP_ORIGIN || 'https://profitku.my.id').trim();
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    cloudReturn = `${u.origin}/settings/stores`;
  } catch {
    /* keep default */
  }
  const finishUrl = `${cloudReturn}?pending=${paymentId}`;

  let paymentLink: string | null = `${cloudReturn}?pending=${paymentId}`;
  let sumopodMeta: { paymentId: string | null; orderId: string | null } = {
    paymentId: null,
    orderId: null,
  };
  let completedImmediately = false;

  const basePaymentRaw = {
    items,
    batch: true,
    storeId: items[0].storeId,
    durationMonths: items[0].durationMonths,
    ...(voucherMeta || {}),
    ...(affiliateMeta
      ? {
          affiliateCode: affiliateMeta.code,
          affiliateName: affiliateMeta.name,
          affiliateCapturedAt: affiliateMeta.capturedAt,
        }
      : {}),
  };

  // Amount 0 (voucher gratis / lifetime): fulfill langsung tanpa gateway.
  if (amount <= 0) {
    provider = voucherMeta ? 'voucher' : 'comp';
    paymentLink = null;
    try {
      await sbPost(c.env, 'payments', {
        id: paymentId,
        user_id: userId,
        store_id: items[0].storeId,
        plan_id: CLOUD_PLAN_ID,
        amount: 0,
        status: 'PENDING',
        provider,
        payment_link: null,
        provider_ref: paymentId,
        raw: basePaymentRaw,
      });
      await fulfillCompletedPayment(c.env, {
        paymentId,
        userId: String(userId),
        userEmail: c.get('userEmail'),
        provider,
        providerRef: voucherMeta?.voucherCode || paymentId,
      });
      completedImmediately = true;
    } catch (err) {
      console.error('[checkout-batch free]', err);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal mengaktifkan layanan gratis' },
        500,
      );
    }
    return c.json({
      message: `Checkout ${priced.planName} (${items.length} toko)`,
      paymentLink: null,
      completed: completedImmediately,
      transaction: {
        id: paymentId,
        status: 'COMPLETED',
        planId: CLOUD_PLAN_ID,
        amount: 0,
        provider,
        voucherCode: voucherMeta?.voucherCode ?? null,
      },
    });
  }

  if (!['mock', 'midtrans', 'sumopod'].includes(provider)) {
    return c.json({ error: 'Payment provider belum diaktifkan' }, 501);
  }
  if (provider === 'midtrans' && !midtransConfigured(c.env)) {
    return c.json({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi' }, 503);
  }
  if (provider === 'sumopod' && !sumopodConfigured(c.env)) {
    return c.json({ error: 'SUMOPOD_API_KEY belum dikonfigurasi' }, 503);
  }
  // BILL-006: mock = entitlement gratis via /payments/verify — dilarang di production.
  if (provider === 'mock' && c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Payment provider mock tidak diizinkan di production' }, 503);
  }

  // Persist payment sebelum panggil gateway (anti transaksi yatim).
  try {
    await sbPost(c.env, 'payments', {
      id: paymentId,
      user_id: userId,
      store_id: items[0].storeId,
      plan_id: CLOUD_PLAN_ID,
      amount,
      status: 'PENDING',
      provider,
      payment_link: null,
      provider_ref: paymentId,
      raw: basePaymentRaw,
    });
  } catch (err) {
    console.error('[checkout-batch] persist payment', err);
    return c.json({ error: 'Gagal menyiapkan transaksi pembayaran' }, 503);
  }

  if (provider === 'mock') {
    paymentLink = `${cloudReturn}?mock_pay=${paymentId}&plan=${CLOUD_PLAN_ID}`;
  } else if (provider === 'midtrans') {
    try {
      const snap = await createSnapTransaction(c.env, {
        orderId: paymentId,
        amount,
        planName: voucherMeta
          ? `${priced.planName} (${normalizeVoucherCode(voucherMeta.voucherCode)})`
          : priced.planName,
        customerEmail: c.get('userEmail'),
        customerName: c.get('userEmail')?.split('@')[0] || 'Profitku',
        finishUrl,
      });
      paymentLink = snap.redirectUrl;
    } catch (err) {
      console.error('[checkout-batch midtrans]', err);
      await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
        status: 'FAILED',
        raw: { ...basePaymentRaw, providerError: err instanceof Error ? err.message : 'gateway_error' },
      }).catch(() => undefined);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi Midtrans' },
        502,
      );
    }
  } else if (provider === 'sumopod') {
    try {
      const sumopod = await createSumopodPayment(c.env, {
        orderId: paymentId,
        amount,
        finishUrl,
      });
      paymentLink = sumopod.paymentLink;
      sumopodMeta = { paymentId: sumopod.paymentId, orderId: sumopod.orderId };
    } catch (err) {
      console.error('[checkout-batch sumopod]', err);
      await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
        status: 'FAILED',
        raw: { ...basePaymentRaw, providerError: err instanceof Error ? err.message : 'gateway_error' },
      }).catch(() => undefined);
      return c.json(
        { error: err instanceof Error ? err.message : 'Gagal membuat transaksi SumoPod' },
        502,
      );
    }
  }

  try {
    await sbPatch(c.env, `payments?id=eq.${paymentId}`, {
      payment_link: paymentLink,
      raw: {
        ...basePaymentRaw,
        sumopod: sumopodMeta.paymentId || sumopodMeta.orderId ? sumopodMeta : null,
      },
    });
  } catch (err) {
    console.error('[checkout-batch] finalize', err);
    return c.json({ error: 'Transaksi dibuat tetapi gagal menyimpan detail gateway' }, 503);
  }

  return c.json({
    message: `Checkout ${priced.planName} (${items.length} toko)`,
    paymentLink,
    completed: completedImmediately,
    transaction: {
      id: paymentId,
      status: 'PENDING',
      planId: CLOUD_PLAN_ID,
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
  // BILL-006: mock auto-complete = entitlement gratis — dilarang di production.
  if (provider === 'mock' && c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Payment provider mock tidak diizinkan di production' }, 503);
  }

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
        if (!st.grossAmount || Math.round(Number(st.grossAmount)) !== Number(pay.amount)) {
          return c.json({ error: 'payment amount mismatch' }, 400);
        }
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

// Google Play ditunda. Jangan memberi entitlement sebelum verifikasi resmi
// Google Play Developer API dan idempotency provider siap.
paymentsRoutes.post('/payments/google-play/verify', async (c: AppContext) => {
  return c.json({ error: 'Google Play billing belum diaktifkan' }, 410);
});

export default paymentsRoutes;
