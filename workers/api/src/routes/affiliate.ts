/**
 * Profitku API — Affiliate (auto REF, dashboard affiliator, pohon referral).
 *
 * Public:
 *   GET  /api/affiliate/lookup?code=KODE  → validasi kode (dipakai POS & SPA)
 *
 * Auth (Bearer Supabase access token):
 *   POST /api/affiliate/register          → daftar jadi affiliator (auto code)
 *   GET  /api/affiliate/me                → profil + link + tiers
 *   GET  /api/affiliate/tree              → pohon downline s.d. 5 tier
 *   GET  /api/affiliate/commissions       → komisi sendiri + ringkasan per tier
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sbGet } from '../lib/supabase';
import {
  buildAffiliateTree,
  getAffiliateSettings,
  isValidAffiliateCode,
  loadAffiliateById,
  loadAffiliateByCode,
  loadAffiliateByUserId,
  normalizeAffiliateCode,
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
      return c.json({ valid: true, code: affiliate.code, name: affiliate.name });
    }
    return c.json({ valid: false, error: 'Layanan affiliasi belum tersedia' }, 503);
  } catch (err) {
    console.warn('[affiliate lookup]', err);
    return c.json({ valid: false, error: 'Gagal memeriksa kode affiliasi' }, 500);
  }
});

// --- Register (auth) ---
// Siapa pun bisa daftar jadi affiliator (tidak wajib berlangganan). Kode REF
// dibuat otomatis di server. `refCode` (opsional) mengikat ke parent → pohon tier.
affiliateRoutes.post('/register', async (c) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Layanan affiliasi belum tersedia' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    refCode?: string;
    bankName?: string;
    bankAccountNo?: string;
    bankAccountName?: string;
    payoutNote?: string;
  };
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'Nama wajib diisi' }, 400);

  let refCode: string | null = null;
  if (body.refCode && String(body.refCode).trim()) {
    const norm = normalizeAffiliateCode(String(body.refCode));
    if (!isValidAffiliateCode(norm)) {
      return c.json({ error: 'Kode referal tidak valid' }, 400);
    }
    refCode = norm;
  }

  try {
    const result = await registerAffiliate(c.env, {
      userId,
      email: c.get('userEmail'),
      name,
      refCode,
      bankName: body.bankName ?? null,
      bankAccountNo: body.bankAccountNo ?? null,
      bankAccountName: body.bankAccountName ?? null,
      payoutNote: body.payoutNote ?? null,
    });
    const settings = await getAffiliateSettings(c.env);
    return c.json({
      ok: true,
      created: result.created,
      affiliate: mapAffiliate(result.affiliate),
      parentCode: result.parentCode,
      tiers: settings.tiers,
      link: `https://profitku.my.id/?ref=${result.affiliate.code}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mendaftar';
    if (message === 'Kode referal tidak valid') {
      return c.json({ error: message }, 400);
    }
    console.warn('[affiliate register]', err);
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
      link: `https://profitku.my.id/?ref=${me.code}`,
    });
  } catch (err) {
    console.warn('[affiliate me]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat profil affiliasi' }, 500);
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

    return c.json({
      ok: true,
      commissions: rows.map(mapCommission),
      summary,
      totals: { earnedIdr, paidIdr },
    });
  } catch (err) {
    console.warn('[affiliate commissions]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat komisi' }, 500);
  }
});

export default affiliateRoutes;
