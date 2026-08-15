/**
 * Profitku API — Affiliate (auto REF, dashboard affiliator, pohon referral).
 *
 * Public:
 *   GET  /api/affiliate/lookup?code=KODE  → validasi kode (dipakai POS & SPA)
 *
 * Auth (Bearer Supabase access token):
 *   POST /api/affiliate/claim          → kunci referral + auto-register affiliator (invite-only, wajib refCode)
 *   GET  /api/affiliate/me             → profil + link + tiers
 *   GET  /api/affiliate/tree           → pohon downline s.d. 5 tier
 *   GET  /api/affiliate/commissions    → komisi sendiri + ringkasan per tier
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPatch } from '../lib/supabase';
import { rateLimit } from '../lib/rate-limit';
import {
  buildAffiliateTree,
  claimAffiliate,
  getAffiliateSettings,
  isValidAffiliateCode,
  loadAffiliateById,
  loadAffiliateByCode,
  loadAffiliateByUserId,
  normalizeAffiliateCode,
  referralLink,
  registerAffiliate,
  type AffiliateRow,
} from '../lib/affiliates';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const affiliateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireUser(c: {
  get: (k: 'userId' | 'userEmail') => string | null;
  json: (b: unknown, s?: number) => Response;
}): string | Response {
  const id = c.get('userId');
  if (!id) return c.json({ error: 'Belum login' }, 401);
  return id;
}

type CommissionRow = {
  id: string;
  affiliate_id: string;
  payment_id: string;
  user_id: string;
  amount_paid: number;
  rate_percent: number;
  commission_idr: number;
  tier: number | null;
  status: string;
  paid_at: string | null;
  created_at: string;
};

const mapAffiliate = (r: AffiliateRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  userId: r.user_id,
  referredBy: r.referred_by,
  payoutNote: r.payout_note,
  bankName: r.bank_name,
  bankAccountNo: r.bank_account_no,
  bankAccountName: r.bank_account_name,
  isActive: r.is_active,
  hasNpwp: r.has_npwp ?? false,
  minAmountIdr: r.min_amount_idr ?? null,
  clickCount: r.click_count ?? 0,
  signupCount: r.signup_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at ?? r.created_at,
});

const mapCommission = (c: CommissionRow) => ({
  id: c.id,
  affiliateId: c.affiliate_id,
  paymentId: c.payment_id,
  userId: c.user_id,
  amountPaid: c.amount_paid,
  ratePercent: c.rate_percent,
  commissionIdr: c.commission_idr,
  tier: c.tier ?? 1,
  status: c.status,
  paidAt: c.paid_at,
  createdAt: c.created_at,
});

// --- Lookup (publik, tanpa auth) ---
// Dipakai client saat user membuka link ?ref=KODE untuk memvalidasi + menampilkan nama affiliator.
affiliateRoutes.get('/lookup', async (c) => {
  const { allowed, retryAfterSeconds } = rateLimit(`affiliate-lookup:${c.req.header('cf-connecting-ip') ?? '?'}`, 60, 60_000);
  if (!allowed) {
    return c.json({ valid: false, error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, 429);
  }
  const code = normalizeAffiliateCode(c.req.query('code') || '');
  if (!code) return c.json({ valid: false, error: 'Kode affiliasi wajib' }, 400);
  if (!isValidAffiliateCode(code)) {
    return c.json({ valid: false, error: 'Format kode affiliasi tidak valid' }, 400);
  }
  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      const affiliate = await loadAffiliateByCode(c.env, code);
      if (!affiliate) {
        return c.json({ valid: false, error: 'Kode affiliasi tidak ditemukan atau nonaktif' });
      }
      // Klik link undangan = hit counter (best-effort; race tidak masalah untuk statistik).
      try {
        const cur = await sbGet<{ click_count: number }[]>(
          c.env,
          `affiliates?id=eq.${affiliate.id}&select=click_count&limit=1`,
        ).catch(() => [] as { click_count: number }[]);
        await sbPatch(c.env, `affiliates?id=eq.${affiliate.id}`, {
          click_count: (cur[0]?.click_count ?? 0) + 1,
        });
      } catch (err) {
        console.warn('[affiliate lookup click]', err);
      }
      return c.json({ valid: true, code: affiliate.code, name: affiliate.name });
    }
    return c.json({ valid: false, error: 'Layanan affiliasi belum tersedia' }, 503);
  } catch (err) {
    console.warn('[affiliate lookup]', err);
    return c.json({ valid: false, error: 'Gagal memeriksa kode affiliasi' }, 500);
  }
});

// --- Settings (publik, tanpa auth) — dipakai landing affiliate.profitku.my.id ---
// Mengembalikan persen komisi per tier yang sedang aktif (diatur admin), agar
// landing otomatis menampilkan nilai terkini tanpa redeploy.
affiliateRoutes.get('/settings', async (c) => {
  try {
    const settings = await getAffiliateSettings(c.env);
    return c.json({
      settings: {
        enabled: settings.enabled,
        tiers: settings.tiers,
      },
    });
  } catch (err) {
    console.warn('[affiliate settings public]', err);
    return c.json({ error: 'Gagal memuat settings affiliasi' }, 500);
  }
});

// --- Claim (auth) — SATU-SATUNYA jalur user menjadi affiliator (invite-only) ---
// User hanya menjadi affiliator setelah membuka link ?ref=KODE dan login Google.
// Pendaftaran manual (POST /register) dihapus — kode REF wajib dan parent
// dikunci permanen (first valid referral wins). Idempotent: user yang sudah
// punya affiliate row tidak diganti parent-nya.
affiliateRoutes.post('/claim', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const { allowed, retryAfterSeconds } = rateLimit(`affiliate-claim:${userId}`, 10, 60_000);
  if (!allowed) {
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.` }, 429);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as { refCode?: string; name?: string };
  const refCode = normalizeAffiliateCode(body.refCode || '');
  if (!refCode || !isValidAffiliateCode(refCode)) {
    return c.json({ error: 'Kode referal tidak valid' }, 400);
  }

  try {
    const result = await claimAffiliate(c.env, {
      userId,
      email: c.get('userEmail'),
      name: (body.name || '').trim().slice(0, 120) || null,
      refCode,
    });
    // User baru via link undangan → naikkan counter signup pengundang (best-effort).
    if (result.created && result.affiliate.referred_by) {
      try {
        const parent = await sbGet<{ signup_count: number }[]>(
          c.env,
          `affiliates?id=eq.${result.affiliate.referred_by}&select=signup_count&limit=1`,
        ).catch(() => [] as { signup_count: number }[]);
        await sbPatch(c.env, `affiliates?id=eq.${result.affiliate.referred_by}`, {
          signup_count: (parent[0]?.signup_count ?? 0) + 1,
        });
      } catch (err) {
        console.warn('[affiliate claim signup]', err);
      }
    }
    const settings = await getAffiliateSettings(c.env);
    return c.json({
      ok: true,
      claimed: result.created,
      affiliate: mapAffiliate(result.affiliate),
      parentCode: result.parentCode,
      tiers: settings.tiers,
      link: await referralLink(c.env, result.affiliate.code),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengklaim referral';
    if (message === 'Kode referal tidak valid') {
      return c.json({ error: message }, 400);
    }
    console.warn('[affiliate claim]', err);
    return c.json({ error: message }, 500);
  }
});

// --- Me (auth) ---
affiliateRoutes.get('/me', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }
  try {
    const me = await loadAffiliateByUserId(c.env, userId);
    if (!me) return c.json({ ok: false, registered: false });

    const settings = await getAffiliateSettings(c.env);
    let parentCode: string | null = null;
    if (me.referred_by) {
      const parent = await loadAffiliateById(c.env, me.referred_by);
      parentCode = parent?.code ?? null;
    }
    return c.json({
      ok: true,
      registered: true,
      affiliate: mapAffiliate(me),
      parentCode,
      tiers: settings.tiers,
      link: await referralLink(c.env, me.code),
    });
  } catch (err) {
    console.warn('[affiliate me]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat profil affiliasi' }, 500);
  }
});

// --- Update profil affiliator sendiri (auth) — nama tampil + detail rekening ---
affiliateRoutes.patch('/me', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    bankName?: unknown;
    bankAccountNo?: unknown;
    bankAccountName?: unknown;
    hasNpwp?: unknown;
  };
  const clean = (v: unknown, max: number): string | null => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };

  const update: Record<string, string | null | boolean> = {};
  if (body.hasNpwp !== undefined) {
    if (typeof body.hasNpwp !== 'boolean') {
      return c.json({ error: 'hasNpwp harus boolean' }, 400);
    }
    update.has_npwp = body.hasNpwp;
  }
  if (body.name !== undefined) {
    const name = clean(body.name, 120);
    if (!name) return c.json({ error: 'Nama wajib diisi' }, 400);
    update.name = name;
  }
  if (body.bankName !== undefined) update.bank_name = clean(body.bankName, 120);
  if (body.bankAccountNo !== undefined) update.bank_account_no = clean(body.bankAccountNo, 50);
  if (body.bankAccountName !== undefined) update.bank_account_name = clean(body.bankAccountName, 120);
  if (Object.keys(update).length === 0) {
    return c.json({ error: 'Tidak ada field yang diubah' }, 400);
  }

  try {
    const me = await loadAffiliateByUserId(c.env, userId);
    if (!me) return c.json({ ok: false, registered: false });
    const rows = await sbPatch<AffiliateRow[]>(c.env, `affiliates?id=eq.${me.id}`, update);
    const row = rows[0];
    if (!row) return c.json({ error: 'Affiliator tidak ditemukan' }, 404);
    return c.json({ ok: true, affiliate: mapAffiliate(row) });
  } catch (err) {
    console.warn('[affiliate me patch]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan detail affiliasi' }, 500);
  }
});

// --- Tree (auth) — pohon downline s.d. 5 tier ---
affiliateRoutes.get('/tree', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }
  try {
    const me = await loadAffiliateByUserId(c.env, userId);
    if (!me) return c.json({ ok: false, registered: false });

    const settings = await getAffiliateSettings(c.env);
    const tree = await buildAffiliateTree(c.env, me.id);
    return c.json({ ok: true, tiers: settings.tiers, tree });
  } catch (err) {
    console.warn('[affiliate tree]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat pohon referral' }, 500);
  }
});

// --- Commissions (auth) — komisi sendiri + ringkasan per tier ---
affiliateRoutes.get('/commissions', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }
  try {
    const me = await loadAffiliateByUserId(c.env, userId);
    if (!me) return c.json({ ok: false, registered: false });

    const rows = await sbGet<CommissionRow[]>(
      c.env,
      `affiliate_commissions?affiliate_id=eq.${me.id}&order=created_at.desc&limit=500&select=id,payment_id,user_id,amount_paid,rate_percent,commission_idr,tier,status,paid_at,created_at`,
    ).catch(() => [] as CommissionRow[]);

    const summary: Record<number, { count: number; earnedIdr: number }> = {};
    let earnedIdr = 0;
    let paidIdr = 0;
    for (const r of rows) {
      const tier = r.tier ?? 1;
      const s = summary[tier] ?? { count: 0, earnedIdr: 0 };
      s.count += 1;
      if (r.status !== 'void') {
        s.earnedIdr += r.commission_idr || 0;
        earnedIdr += r.commission_idr || 0;
      }
      if (r.status === 'paid') paidIdr += r.commission_idr || 0;
      summary[tier] = s;
    }

    const settings = await getAffiliateSettings(c.env);
    const pendingIdr = Math.max(0, earnedIdr - paidIdr);
    // Threshold per mitra (override) atau global.
    const payoutThresholdIdr = me.min_amount_idr ?? settings.min_amount_idr;

    return c.json({
      ok: true,
      commissions: rows.map(mapCommission),
      summary,
      totals: { earnedIdr, paidIdr },
      payoutThresholdIdr,
      pendingIdr,
      eligibleForPayout: payoutThresholdIdr <= 0 || pendingIdr >= payoutThresholdIdr,
    });
  } catch (err) {
    console.warn('[affiliate commissions]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat komisi' }, 500);
  }
});

export default affiliateRoutes;
