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
  getAffiliateSettings,
  isValidAffiliateCode,
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
  status: string;
  paid_at: string | null;
  created_at: string;
};

type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  payout_note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

const mapCommission = (c: CommissionRow) => ({
  id: c.id,
  affiliateId: c.affiliate_id,
  paymentId: c.payment_id,
  userId: c.user_id,
  amountPaid: c.amount_paid,
  ratePercent: c.rate_percent,
  commissionIdr: c.commission_idr,
  status: c.status,
  paidAt: c.paid_at,
  createdAt: c.created_at,
});

function validateSettingsBody(body: Record<string, unknown>): string | null {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return "Field 'enabled' harus boolean";
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
  const next: AffiliateSettings = {
    enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
    commission_percent:
      body.commission_percent === undefined
        ? current.commission_percent
        : Math.max(0, Math.min(100, Math.floor(Number(body.commission_percent)))),
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
        'affiliate_commissions?select=id,affiliate_id,payment_id,user_id,amount_paid,rate_percent,commission_idr,status,paid_at,created_at&limit=5000',
      ).catch(() => [] as CommissionRow[]),
    ]);

    const byAffiliate = new Map<string, CommissionRow[]>();
    for (const cm of commissions) {
      const list = byAffiliate.get(cm.affiliate_id) ?? [];
      list.push(cm);
      byAffiliate.set(cm.affiliate_id, list);
    }

    const list = rows.map((r) => {
      const cm = byAffiliate.get(r.id) ?? [];
      const totalCommission = cm.reduce((s, x) => s + (x.commission_idr || 0), 0);
      const earned = cm.filter((x) => x.status === 'earned');
      const paid = cm.filter((x) => x.status === 'paid');
      const referredUsers = new Set(cm.map((x) => x.user_id)).size;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        userId: r.user_id,
        payoutNote: r.payout_note,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
        stats: {
          referrals: cm.length,
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
    payoutNote?: string;
  };
  const code = normalizeAffiliateCode(body.code || '');
  const name = (body.name || '').trim();

  if (!isValidAffiliateCode(code)) {
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

  try {
    const existing = await sbGet<{ id: string }[]>(
      c.env,
      `affiliates?code=eq.${code}&select=id&limit=1`,
    );
    if (existing[0]) return c.json({ error: `Kode '${code}' sudah dipakai` }, 409);

    const rows = await sbPost<AffiliateRow[]>(c.env, 'affiliates', {
      code,
      name,
      user_id: userId,
      payout_note: (body.payoutNote || '').trim() || null,
      is_active: true,
    });
    const row = rows[0];
    if (!row) return c.json({ error: 'Gagal membuat affiliator' }, 500);

    await writeAudit(c.env, a as AdminContext, 'affiliate.create', 'affiliates', row.id, {
      code,
      name,
      userId,
    });
    await writeEvent(c.env, {
      type: 'admin.affiliate.create',
      message: `Admin created affiliate ${code}`,
      actorUserId: a.userId,
      payload: { code, name, actorEmail: a.email },
    });

    return c.json({
      ok: true,
      affiliate: {
        id: row.id,
        code: row.code,
        name: row.name,
        userId: row.user_id,
        payoutNote: row.payout_note,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? row.created_at,
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
      `affiliate_commissions?affiliate_id=eq.${id}&order=created_at.desc&limit=200&select=id,affiliate_id,payment_id,user_id,amount_paid,rate_percent,commission_idr,status,paid_at,created_at`,
    ).catch(() => [] as CommissionRow[]);

    return c.json({
      affiliate: {
        id: row.id,
        code: row.code,
        name: row.name,
        userId: row.user_id,
        payoutNote: row.payout_note,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? row.created_at,
      },
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
      affiliate: {
        id: row.id,
        code: row.code,
        name: row.name,
        userId: row.user_id,
        payoutNote: row.payout_note,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? row.created_at,
      },
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
