/**
 * Profitku Admin — Affiliate API (/admin/api/affiliates*).
 * Staff only. Mengelola affiliator + settings komisi + daftar komisi.
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPatch, sbPost } from '../lib/supabase';
import { canWrite, requireAdmin, writeAudit, writeEvent, type AdminContext } from '../lib/admin';
import {
  DEFAULT_AFFILIATE_SETTINGS,
  generateAffiliateCode,
  getAffiliateSettings,
  isValidAffiliateCode,
  loadAffiliateByCode,
  normalizeAffiliateCode,
  type AffiliateSettings,
} from '../lib/affiliates';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const affiliates = new Hono<{ Bindings: Env; Variables: Variables }>();

type CommissionRow = {
  id: string;
  affiliate_id: string;
  payment_id: string;
  user_id: string;
  amount_paid: number;
  rate_percent: number;
  commission_idr: number;
  tier?: number | null;
  status: string;
  paid_at: string | null;
  created_at: string;
};

type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  referred_by: string | null;
  payout_note: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
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

function validateSettingsBody(body: Record<string, unknown>): string | null {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return "Field 'enabled' harus boolean";
  }
  if (body.tiers !== undefined) {
    if (!Array.isArray(body.tiers) || body.tiers.length < 1 || body.tiers.length > 5) {
      return "Field 'tiers' harus array 1–5 angka (komisi per tier)";
    }
    for (const t of body.tiers) {
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return "Field 'tiers' harus berisi angka 0–100";
      }
    }
  }
  if (body.commission_percent !== undefined) {
    const n = Number(body.commission_percent);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return "Field 'commission_percent' harus angka 0–100";
    }
  }
  if (body.attribution_days !== undefined) {
    const n = Number(body.attribution_days);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      return "Field 'attribution_days' harus angka 1–3650";
    }
  }
  if (body.min_amount_idr !== undefined) {
    const n = Number(body.min_amount_idr);
    if (!Number.isFinite(n) || n < 0) {
      return "Field 'min_amount_idr' harus angka >= 0";
    }
  }
  return null;
}

// --- Settings (didaftarkan sebelum /:id agar tidak tertangkap param) ---
affiliates.get('/settings', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const settings = await getAffiliateSettings(c.env);
  return c.json({ settings });
});

affiliates.patch('/settings', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canWrite(a.role)) {
    return c.json({ error: 'Role tidak boleh mengubah settings affiliate' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const validationError = validateSettingsBody(body);
  if (validationError) return c.json({ error: validationError }, 400);

  const current = await getAffiliateSettings(c.env);
  let commission_percent = current.commission_percent;
  let tiers = current.tiers;
  if (body.commission_percent !== undefined) {
    commission_percent = Math.max(0, Math.min(100, Math.floor(Number(body.commission_percent))));
  }
  if (body.tiers !== undefined) {
    tiers = (body.tiers as unknown[])
      .map((t) => Math.max(0, Math.min(100, Math.floor(Number(t)))))
      .slice(0, 5);
    // Jaga kompatibilitas legacy: commission_percent mengikuti tier 1.
    commission_percent = tiers[0] ?? commission_percent;
  }
  const next: AffiliateSettings = {
    enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
    commission_percent,
    tiers,
    attribution_days:
      body.attribution_days === undefined
        ? current.attribution_days
        : Math.max(1, Math.min(3650, Math.floor(Number(body.attribution_days)))),
    min_amount_idr:
      body.min_amount_idr === undefined
        ? current.min_amount_idr
        : Math.max(0, Math.floor(Number(body.min_amount_idr))),
  };

  try {
    const update = {
      value: next,
      updated_at: new Date().toISOString(),
      updated_by: a.userId,
    };
    await sbPost(c.env, 'platform_settings', { key: 'affiliate', ...update }).catch(() =>
      sbPatch(c.env, 'platform_settings?key=eq.affiliate', update),
    );
    await writeAudit(c.env, a as AdminContext, 'affiliate.settings.update', 'platform_settings', 'affiliate', {
      settings: next,
    });
    return c.json({ ok: true, settings: next });
  } catch (err) {
    console.error('[admin affiliate settings]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal simpan settings' }, 500);
  }
});

// --- List with per-affiliate stats ---
affiliates.get('/', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  try {
    const [rows, commissions] = await Promise.all([
      sbGet<AffiliateRow[]>(c.env, 'affiliates?order=created_at.desc&select=*'),
      sbGet<CommissionRow[]>(
        c.env,
        'affiliate_commissions?select=id,affiliate_id,payment_id,user_id,amount_paid,rate_percent,commission_idr,tier,status,paid_at,created_at&limit=5000',
      ).catch(() => [] as CommissionRow[]),
    ]);

    const byAffiliate = new Map<string, CommissionRow[]>();
    for (const cm of commissions) {
      const list = byAffiliate.get(cm.affiliate_id) ?? [];
      list.push(cm);
      byAffiliate.set(cm.affiliate_id, list);
    }
    const codeById = new Map(rows.map((r) => [r.id, r.code]));

    // Batch lookup email affiliator (profiles) untuk kolom email.
    const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))];
    let emailById = new Map<string, string | null>();
    if (userIds.length > 0) {
      try {
        const profs = await sbGet<{ id: string; email: string | null }[]>(
          c.env,
          `profiles?id=in.(${userIds.join(',')})&select=id,email`,
        );
        emailById = new Map(profs.map((p) => [p.id, p.email]));
      } catch {
        /* email optional */
      }
    }

    const list = rows.map((r) => {
      const cm = byAffiliate.get(r.id) ?? [];
      const totalCommission = cm.reduce((s, x) => s + (x.commission_idr || 0), 0);
      const earned = cm.filter((x) => x.status === 'earned');
      const paid = cm.filter((x) => x.status === 'paid');
      const referredUsers = new Set(cm.map((x) => x.user_id)).size;
      return {
        ...mapAffiliate(r),
        userEmail: r.user_id ? (emailById.get(r.user_id) ?? null) : null,
        referredByCode: r.referred_by ? (codeById.get(r.referred_by) ?? null) : null,
        stats: {
          // Referral = jumlah payment unik (bukan jumlah baris — 1 payment bisa punya 5 tier).
          referrals: new Set(cm.map((x) => x.payment_id)).size,
          referredUsers,
          totalCommissionIdr: totalCommission,
          earnedCommissionIdr: earned.reduce((s, x) => s + x.commission_idr, 0),
          paidCommissionIdr: paid.reduce((s, x) => s + x.commission_idr, 0),
        },
      };
    });

    return c.json({ affiliates: list });
  } catch (err) {
    console.error('[admin affiliates]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat affiliates' }, 500);
  }
});

// --- Create ---
affiliates.post('/', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canWrite(a.role)) {
    return c.json({ error: 'Role tidak boleh membuat affiliator' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    name?: string;
    userId?: string;
    userEmail?: string;
    referredByCode?: string;
    payoutNote?: string;
    bankName?: string;
    bankAccountNo?: string;
    bankAccountName?: string;
  };
  const code = normalizeAffiliateCode(body.code || '');
  const name = (body.name || '').trim();

  if (code && !isValidAffiliateCode(code)) {
    return c.json({ error: 'Kode affiliasi 4–24 karakter [A-Z0-9_-], tidak diawali -/_' }, 400);
  }
  if (!name) return c.json({ error: 'Nama affiliator wajib' }, 400);

  let userId: string | null = body.userId || null;
  if (!userId && body.userEmail) {
    try {
      const profs = await sbGet<{ id: string }[]>(
        c.env,
        `profiles?email=eq.${encodeURIComponent(body.userEmail.trim().toLowerCase())}&select=id&limit=1`,
      );
      userId = profs[0]?.id ?? null;
    } catch {
      userId = null;
    }
  }

  // Parent (referred_by) opsional — menghubungkan ke pohon referral tier.
  let referredBy: string | null = null;
  if (body.referredByCode) {
    const rc = normalizeAffiliateCode(body.referredByCode);
    if (!isValidAffiliateCode(rc)) {
      return c.json({ error: 'Kode referal parent tidak valid' }, 400);
    }
    const parent = await loadAffiliateByCode(c.env, rc);
    if (!parent) return c.json({ error: `Parent '${rc}' tidak ditemukan atau nonaktif` }, 400);
    referredBy = parent.id;
  }

  try {
    const insert = async (candidate: string) =>
      sbPost<AffiliateRow[]>(c.env, 'affiliates', {
        code: candidate,
        name,
        user_id: userId,
        referred_by: referredBy,
        payout_note: (body.payoutNote || '').trim() || null,
        bank_name: (body.bankName || '').trim() || null,
        bank_account_no: (body.bankAccountNo || '').trim() || null,
        bank_account_name: (body.bankAccountName || '').trim() || null,
        is_active: true,
      });

    let row: AffiliateRow | undefined;
    if (code) {
      const existing = await sbGet<{ id: string }[]>(
        c.env,
        `affiliates?code=eq.${code}&select=id&limit=1`,
      );
      if (existing[0]) return c.json({ error: `Kode '${code}' sudah dipakai` }, 409);
      const rows = await insert(code);
      row = rows[0];
    } else {
      // REF otomatis: generate kode acak, retry bila bentrok.
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        try {
          const rows = await insert(generateAffiliateCode());
          row = rows[0];
        } catch (err) {
          if (!(err instanceof Error) || !/duplicate/i.test(err.message)) throw err;
        }
      }
    }
    if (!row) return c.json({ error: 'Gagal membuat affiliator (kode bentrok)' }, 500);

    await writeAudit(c.env, a as AdminContext, 'affiliate.create', 'affiliates', row.id, {
      code: row.code,
      name,
      userId,
      referredBy: referredBy ?? undefined,
      bank: row.bank_name ?? null,
    });
    await writeEvent(c.env, {
      type: 'admin.affiliate.create',
      message: `Admin created affiliate ${row.code}`,
      actorUserId: a.userId,
      payload: { code: row.code, name, actorEmail: a.email },
    });

    return c.json({
      ok: true,
      affiliate: {
        ...mapAffiliate(row),
        stats: { referrals: 0, referredUsers: 0, totalCommissionIdr: 0, earnedCommissionIdr: 0, paidCommissionIdr: 0 },
      },
    });
  } catch (err) {
    if (err instanceof Error && /duplicate/i.test(err.message)) {
      return c.json({ error: `Kode '${code}' sudah dipakai` }, 409);
    }
    console.error('[admin affiliate create]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal membuat affiliator' }, 500);
  }
});

// --- Detail + commissions ---
affiliates.get('/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const id = c.req.param('id');

  try {
    const rows = await sbGet<AffiliateRow[]>(c.env, `affiliates?id=eq.${id}&select=*&limit=1`);
    const row = rows[0];
    if (!row) return c.json({ error: 'Affiliator tidak ditemukan' }, 404);

    const commissions = await sbGet<CommissionRow[]>(
      c.env,
      `affiliate_commissions?affiliate_id=eq.${id}&order=created_at.desc&limit=200&select=id,affiliate_id,payment_id,user_id,amount_paid,rate_percent,commission_idr,tier,status,paid_at,created_at`,
    ).catch(() => [] as CommissionRow[]);

    // Email affiliator (profiles) untuk keterangan kontak di detail.
    let userEmail: string | null = null;
    if (row.user_id) {
      try {
        const profs = await sbGet<{ email: string | null }[]>(
          c.env,
          `profiles?id=eq.${row.user_id}&select=email&limit=1`,
        );
        userEmail = profs[0]?.email ?? null;
      } catch {
        /* email optional */
      }
    }

    return c.json({
      affiliate: { ...mapAffiliate(row), userEmail },
      commissions: commissions.map(mapCommission),
    });
  } catch (err) {
    console.error('[admin affiliate detail]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat affiliator' }, 500);
  }
});

// --- Update (name, payout_note, is_active) ---
affiliates.patch('/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canWrite(a.role)) {
    return c.json({ error: 'Role tidak boleh mengubah affiliator' }, 403);
  }
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    payoutNote?: string | null;
    bankName?: string | null;
    bankAccountNo?: string | null;
    bankAccountName?: string | null;
    isActive?: boolean;
  };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = (body.name || '').trim();
    if (!name) return c.json({ error: 'Nama affiliator wajib' }, 400);
    update.name = name;
  }
  if (body.payoutNote !== undefined) {
    update.payout_note = (body.payoutNote || '').trim() || null;
  }
  if (body.bankName !== undefined) {
    update.bank_name = (body.bankName || '').trim() || null;
  }
  if (body.bankAccountNo !== undefined) {
    update.bank_account_no = (body.bankAccountNo || '').trim() || null;
  }
  if (body.bankAccountName !== undefined) {
    update.bank_account_name = (body.bankAccountName || '').trim() || null;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return c.json({ error: "Field 'isActive' harus boolean" }, 400);
    }
    update.is_active = body.isActive;
  }

  try {
    const rows = await sbPatch<AffiliateRow[]>(c.env, `affiliates?id=eq.${id}`, update);
    const row = rows[0];
    if (!row) return c.json({ error: 'Affiliator tidak ditemukan' }, 404);
    await writeAudit(c.env, a as AdminContext, 'affiliate.update', 'affiliates', id, update);
    return c.json({
      ok: true,
      affiliate: mapAffiliate(row),
    });
  } catch (err) {
    console.error('[admin affiliate update]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal update affiliator' }, 500);
  }
});

// --- Mark all earned commissions as paid ---
affiliates.post('/:id/mark-paid', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canWrite(a.role)) {
    return c.json({ error: 'Role tidak boleh menandai komisi terbayar' }, 403);
  }
  const id = c.req.param('id');

  try {
    const rows = await sbGet<{ id: string }[]>(
      c.env,
      `affiliate_commissions?affiliate_id=eq.${id}&status=eq.earned&select=id`,
    );
    if (rows.length === 0) {
      return c.json({ ok: true, updated: 0 });
    }
    const ids = rows.map((r) => r.id);
    await sbPatch(c.env, `affiliate_commissions?affiliate_id=eq.${id}&status=eq.earned`, {
      status: 'paid',
      paid_at: new Date().toISOString(),
    });
    await writeAudit(c.env, a as AdminContext, 'affiliate.mark_paid', 'affiliate_commissions', id, {
      count: ids.length,
    });
    return c.json({ ok: true, updated: ids.length });
  } catch (err) {
    console.error('[admin affiliate mark-paid]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal menandai komisi' }, 500);
  }
});

export default affiliates;
