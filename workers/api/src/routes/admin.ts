/**
 * Profitku Admin API — staff only (/admin/api/*)
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPatch, sbPost, sbDelete } from '../lib/supabase';
import {
  canMutateBilling,
  canWrite,
  requireAdmin,
  writeAudit,
  writeEvent,
  type AdminContext,
} from '../lib/admin';
import { CLOUD_PLAN_PRICE_IDR } from '../data/seed-plans';
import adminSettings from './admin-settings';
import adminAffiliates from './admin-affiliates';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.route('/', adminSettings);
// Mount di path spesifik: route `/:id` di sub-router TIDAK boleh membayangi
// /me, /overview, /members, /payments, /events, /vouchers (route inline di bawah).
admin.route('/affiliates', adminAffiliates);

// --- Semua komisi (lintas affiliator) — menu "Commissions" admin ---
type AdminCommissionRow = {
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

admin.get('/affiliate-commissions', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  try {
    const [rows, affiliates] = await Promise.all([
      sbGet<AdminCommissionRow[]>(
        c.env,
        'affiliate_commissions?select=id,affiliate_id,payment_id,user_id,amount_paid,rate_percent,commission_idr,tier,status,paid_at,created_at&order=created_at.desc&limit=5000',
      ),
      sbGet<{ id: string; code: string; name: string }[]>(
        c.env,
        'affiliates?select=id,code,name&limit=5000',
      ),
    ]);
    const affById = new Map(affiliates.map((x) => [x.id, x]));

    // Email pembayar (user_id) untuk konteks komisi.
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
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

    return c.json({
      commissions: rows.map((r) => {
        const aff = affById.get(r.affiliate_id);
        return {
          id: r.id,
          affiliateId: r.affiliate_id,
          affiliateCode: aff?.code ?? null,
          affiliateName: aff?.name ?? null,
          paymentId: r.payment_id,
          userId: r.user_id,
          userEmail: r.user_id ? (emailById.get(r.user_id) ?? null) : null,
          amountPaid: r.amount_paid,
          ratePercent: r.rate_percent,
          commissionIdr: r.commission_idr,
          tier: r.tier ?? 1,
          status: r.status,
          paidAt: r.paid_at,
          createdAt: r.created_at,
        };
      }),
    });
  } catch (err) {
    console.error('[admin affiliate commissions]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat komisi affiliate' }, 500);
  }
});

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

admin.get('/me', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  return c.json({
    userId: a.userId,
    email: a.email,
    role: a.role,
    canWrite: canWrite(a.role),
    canMutateBilling: canMutateBilling(a.role),
  });
});

admin.get('/overview', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  const now = new Date().toISOString();
  try {
    type Prof = { id: string };
    type Sub = { id: string; status: string; current_period_end: string };
    type Pay = { id: string; amount: number; status: string };
    type Bak = { id: string; file_size: number };

    let activeSubs: Sub[] = [];
    try {
      activeSubs = await sbGet<Sub[]>(
        c.env,
        `subscriptions?status=in.(active,trialing)&or=(is_lifetime.eq.true,current_period_end.gt.${now})&select=id,status,current_period_end`,
      );
    } catch {
      activeSubs = await sbGet<Sub[]>(
        c.env,
        `subscriptions?status=in.(active,trialing)&current_period_end=gt.${now}&select=id,status,current_period_end`,
      );
    }

    const [profiles, payments, backups24h] = await Promise.all([
      sbGet<Prof[]>(c.env, 'profiles?select=id'),
      sbGet<Pay[]>(c.env, 'payments?status=eq.COMPLETED&select=id,amount,status&order=created_at.desc&limit=500'),
      sbGet<Bak[]>(
        c.env,
        `backups?created_at=gte.${new Date(Date.now() - 864e5).toISOString()}&select=id,file_size`,
      ),
    ]);

    const mrrApprox =
      activeSubs.length * (CLOUD_PLAN_PRICE_IDR || 25_000);

    return c.json({
      members: profiles.length,
      activeSubscriptions: activeSubs.length,
      completedPaymentsSample: payments.length,
      revenueCompletedSampleIdr: payments.reduce((s, p) => s + (p.amount || 0), 0),
      backupsLast24h: backups24h.length,
      backupBytesLast24h: backups24h.reduce((s, b) => s + Number(b.file_size || 0), 0),
      mrrApproxIdr: mrrApprox,
      planPriceIdr: CLOUD_PLAN_PRICE_IDR || 25_000,
      generatedAt: now,
    });
  } catch (err) {
    console.error('[admin overview]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat overview' }, 500);
  }
});

admin.get('/members', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  const q = (c.req.query('q') || '').trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));

  try {
    type Prof = {
      id: string;
      email: string | null;
      name: string | null;
      phone: string | null;
      created_at: string;
    };
    let path = `profiles?select=id,email,name,phone,created_at&order=created_at.desc&limit=${limit}`;
    if (q) {
      // PostgREST or filter
      path = `profiles?or=(email.ilike.*${encodeURIComponent(q)}*,name.ilike.*${encodeURIComponent(q)}*)&select=id,email,name,phone,created_at&order=created_at.desc&limit=${limit}`;
    }
    const profiles = await sbGet<Prof[]>(c.env, path);
    const ids = profiles.map((p) => p.id);
    if (ids.length === 0) return c.json({ members: [] });

    const now = new Date().toISOString();
    type Sub = {
      user_id: string;
      status: string;
      current_period_end: string;
      plan_id: string;
    };
    let subs: Sub[] = [];
    try {
      subs = await sbGet<Sub[]>(
        c.env,
        `subscriptions?user_id=in.(${ids.join(',')})&status=in.(active,trialing)&or=(is_lifetime.eq.true,current_period_end.gt.${now})&select=user_id,status,current_period_end,plan_id`,
      );
    } catch {
      subs = await sbGet<Sub[]>(
        c.env,
        `subscriptions?user_id=in.(${ids.join(',')})&status=in.(active,trialing)&current_period_end=gt.${now}&select=user_id,status,current_period_end,plan_id`,
      );
    }
    const subByUser = new Map(subs.map((s) => [s.user_id, s]));

    const members = profiles.map((p) => {
      const s = subByUser.get(p.id);
      return {
        id: p.id,
        email: p.email,
        name: p.name,
        phone: p.phone,
        createdAt: p.created_at,
        subscription: s
          ? {
              status: s.status,
              planId: s.plan_id,
              currentPeriodEnd: s.current_period_end,
              active: true,
            }
          : null,
      };
    });

    return c.json({ members });
  } catch (err) {
    console.error('[admin members]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat members' }, 500);
  }
});

admin.get('/members/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const id = c.req.param('id');

  try {
    type Prof = {
      id: string;
      email: string | null;
      name: string | null;
      phone: string | null;
      picture: string | null;
      created_at: string;
    };
    const profs = await sbGet<Prof[]>(c.env, `profiles?id=eq.${id}&select=*&limit=1`);
    const profile = profs[0];
    if (!profile) return c.json({ error: 'Member tidak ditemukan' }, 404);

    const [subs, payments, backups, stores, notifs] = await Promise.all([
      sbGet<Record<string, unknown>[]>(
        c.env,
        `subscriptions?user_id=eq.${id}&order=created_at.desc&limit=20&select=id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,provider,created_at`,
      ),
      sbGet<Record<string, unknown>[]>(
        c.env,
        `payments?user_id=eq.${id}&order=created_at.desc&limit=30&select=id,plan_id,amount,status,provider,created_at`,
      ),
      sbGet<Record<string, unknown>[]>(
        c.env,
        `backups?user_id=eq.${id}&order=created_at.desc&limit=20&select=id,file_name,file_size,created_at,store_id`,
      ),
      sbGet<Record<string, unknown>[]>(
        c.env,
        `stores?user_id=eq.${id}&order=created_at.desc&select=id,name,identifier,is_public,created_at`,
      ),
      sbGet<Record<string, unknown>[]>(
        c.env,
        `notification_log?user_id=eq.${id}&order=created_at.desc&limit=20&select=id,channel,template,status,recipient,created_at`,
      ),
    ]);

    return c.json({
      profile: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        phone: profile.phone,
        picture: profile.picture,
        createdAt: profile.created_at,
      },
      subscriptions: subs,
      payments,
      backups,
      stores,
      notifications: notifs,
    });
  } catch (err) {
    console.error('[admin member detail]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat member' }, 500);
  }
});

admin.post('/members/:id/extend-subscription', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canMutateBilling(a.role)) {
    return c.json({ error: 'Role tidak boleh mengubah langganan' }, 403);
  }

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    days?: number;
    planId?: string;
    reason?: string;
  };
  const days = Math.min(365, Math.max(1, Number(body.days) || 30));
  const planId = body.planId || 'cloud_monthly';
  const reason = (body.reason || '').trim() || 'manual extend by admin';

  try {
    const now = new Date();
    type Sub = {
      id: string;
      current_period_end: string;
      status: string;
    };
    const existing = await sbGet<Sub[]>(
      c.env,
      `subscriptions?user_id=eq.${id}&status=in.(active,trialing)&order=current_period_end.desc&limit=1&select=id,current_period_end,status`,
    );

    let result: unknown;
    if (existing[0]) {
      const base = new Date(existing[0].current_period_end);
      const from = base.getTime() > now.getTime() ? base : now;
      const end = new Date(from);
      end.setUTCDate(end.getUTCDate() + days);
      result = await sbPatch(c.env, `subscriptions?id=eq.${existing[0].id}`, {
        status: 'active',
        current_period_end: end.toISOString(),
        updated_at: now.toISOString(),
        provider: 'manual',
      });
    } else {
      result = await sbPost(c.env, 'subscriptions', {
        user_id: id,
        plan_id: planId,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: daysFromNow(days),
        provider: 'manual',
        cancel_at_period_end: false,
      });
    }

    await writeAudit(c.env, a as AdminContext, 'subscription.extend', 'user', id, {
      days,
      planId,
      reason,
    }, c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'));

    await writeEvent(c.env, {
      type: 'admin.subscription.extend',
      message: `Admin extended subscription +${days}d for ${id}`,
      actorUserId: a.userId,
      subjectUserId: id,
      payload: { days, planId, reason, actorEmail: a.email },
    });

    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[admin extend]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal extend' }, 500);
  }
});

admin.get('/payments', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));

  try {
    const rows = await sbGet<Record<string, unknown>[]>(
      c.env,
      `payments?order=created_at.desc&limit=${limit}&select=id,user_id,plan_id,amount,status,provider,created_at`,
    );

    // Batch lookup email user (profiles) agar kolom User bisa menampilkan email.
    const userIds = [...new Set(rows.map((r) => String(r.user_id || '')).filter(Boolean))];
    let emailById = new Map<string, string | null>();
    if (userIds.length > 0) {
      try {
        const profs = await sbGet<{ id: string; email: string | null }[]>(
          c.env,
          `profiles?id=in.(${userIds.join(',')})&select=id,email`,
        );
        emailById = new Map(profs.map((p) => [p.id, p.email]));
      } catch {
        /* email optional — fallback ke user_id */
      }
    }

    const payments = rows.map((r) => ({
      ...r,
      user_email: r.user_id ? (emailById.get(String(r.user_id)) ?? null) : null,
    }));
    return c.json({ payments });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat payments' }, 500);
  }
});

admin.get('/events', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)));
  const since = c.req.query('since');

  try {
    let path = `platform_events?order=created_at.desc&limit=${limit}&select=*`;
    if (since) {
      path = `platform_events?created_at=gt.${encodeURIComponent(since)}&order=created_at.desc&limit=${limit}&select=*`;
    }
    const events = await sbGet<Record<string, unknown>[]>(c.env, path);

    // Fallback: notification_log if platform_events empty / missing
    let notifications: Record<string, unknown>[] = [];
    try {
      notifications = await sbGet(
        c.env,
        `notification_log?order=created_at.desc&limit=${Math.min(20, limit)}&select=id,user_id,channel,template,status,recipient,created_at`,
      );
    } catch {
      /* ignore */
    }

    let audits: Record<string, unknown>[] = [];
    try {
      audits = await sbGet(
        c.env,
        `admin_audit_log?order=created_at.desc&limit=${Math.min(20, limit)}&select=id,actor_email,action,entity,entity_id,meta,created_at`,
      );
    } catch {
      /* ignore */
    }

    return c.json({ events, notifications, audits, polledAt: new Date().toISOString() });
  } catch (err) {
    // If platform_events table missing, still return notif/audit
    try {
      const notifications = await sbGet(
        c.env,
        `notification_log?order=created_at.desc&limit=${limit}&select=id,user_id,channel,template,status,recipient,created_at`,
      );
      return c.json({
        events: [],
        notifications,
        audits: [],
        polledAt: new Date().toISOString(),
        warning: 'platform_events belum tersedia — jalankan migrasi admin_ops',
      });
    } catch (err2) {
      return c.json({ error: err2 instanceof Error ? err2.message : 'Gagal memuat events' }, 500);
    }
  }
});

// --- Vouchers ---

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

admin.get('/vouchers', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  try {
    type V = {
      id: string;
      code: string;
      type: string;
      value: number;
      plan_id: string | null;
      max_redemptions: number | null;
      max_per_user: number;
      starts_at: string | null;
      ends_at: string | null;
      is_active: boolean;
      note: string | null;
      created_at: string;
    };
    const vouchers = await sbGet<V[]>(
      c.env,
      'vouchers?order=created_at.desc&limit=100&select=id,code,type,value,plan_id,max_redemptions,max_per_user,starts_at,ends_at,is_active,note,created_at',
    );

    const withCounts = await Promise.all(
      vouchers.map(async (v) => {
        let redemptions = 0;
        try {
          const rows = await sbGet<{ id: string }[]>(
            c.env,
            `voucher_redemptions?voucher_id=eq.${v.id}&select=id&limit=1000`,
          );
          redemptions = rows.length;
        } catch {
          /* ignore */
        }
        return { ...v, redemptionCount: redemptions };
      }),
    );

    return c.json({ vouchers: withCounts });
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Gagal memuat vouchers — jalankan migrasi 20260724180000_vouchers',
      },
      500,
    );
  }
});

admin.get('/vouchers/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  const id = c.req.param('id');

  try {
    const vouchers = await sbGet<Record<string, unknown>[]>(
      c.env,
      `vouchers?id=eq.${id}&select=*&limit=1`,
    );
    const voucher = vouchers[0];
    if (!voucher) return c.json({ error: 'Voucher tidak ditemukan' }, 404);

    const redemptions = await sbGet<Record<string, unknown>[]>(
      c.env,
      `voucher_redemptions?voucher_id=eq.${id}&order=redeemed_at.desc&limit=50&select=id,user_id,payment_id,amount_before,amount_after,effect,redeemed_at`,
    );

    return c.json({ voucher, redemptions });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat voucher' }, 500);
  }
});

admin.post('/vouchers', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canMutateBilling(a.role)) {
    return c.json({ error: 'Role tidak boleh membuat voucher' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    type?: string;
    value?: number;
    planId?: string | null;
    maxRedemptions?: number | null;
    maxPerUser?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    isActive?: boolean;
    note?: string | null;
  };

  const code = normalizeCode(body.code || '');
  const type = (body.type || '').toLowerCase();
  if (code.length < 2) return c.json({ error: 'Kode minimal 2 karakter' }, 400);
  if (!['percent', 'free_days', 'lifetime'].includes(type)) {
    return c.json({ error: 'type harus percent | free_days | lifetime' }, 400);
  }

  let value = Math.floor(Number(body.value) || 0);
  if (type === 'percent' && (value < 1 || value > 100)) {
    return c.json({ error: 'percent value 1–100' }, 400);
  }
  if (type === 'free_days' && (value < 1 || value > 3650)) {
    return c.json({ error: 'free_days value 1–3650' }, 400);
  }
  if (type === 'lifetime') value = 0;

  try {
    const rows = await sbPost<Record<string, unknown>[]>(c.env, 'vouchers', {
      code,
      type,
      value,
      plan_id: body.planId || 'cloud_monthly',
      max_redemptions: body.maxRedemptions == null || body.maxRedemptions === undefined
        ? null
        : Math.max(1, Math.floor(Number(body.maxRedemptions))),
      max_per_user: Math.max(1, Math.floor(Number(body.maxPerUser) || 1)),
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      is_active: body.isActive !== false,
      note: body.note || null,
      created_by: a.userId,
    });

    const voucher = Array.isArray(rows) ? rows[0] : rows;

    await writeAudit(c.env, a, 'voucher.create', 'voucher', String((voucher as { id?: string })?.id || code), {
      code,
      type,
      value,
    });
    await writeEvent(c.env, {
      type: 'admin.voucher.create',
      message: `Admin created voucher ${code} (${type})`,
      actorUserId: a.userId,
      payload: { code, type, value, actorEmail: a.email },
    });

    return c.json({ ok: true, voucher }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal membuat voucher';
    if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) {
      return c.json({ error: 'Kode voucher sudah ada' }, 409);
    }
    return c.json({ error: msg }, 500);
  }
});

admin.patch('/vouchers/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canMutateBilling(a.role)) {
    return c.json({ error: 'Role tidak boleh mengubah voucher' }, 403);
  }

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    isActive?: boolean;
    maxRedemptions?: number | null;
    maxPerUser?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    note?: string | null;
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.isActive !== undefined) patch.is_active = !!body.isActive;
  if (body.maxRedemptions !== undefined) {
    patch.max_redemptions =
      body.maxRedemptions == null ? null : Math.max(1, Math.floor(Number(body.maxRedemptions)));
  }
  if (body.maxPerUser !== undefined) {
    patch.max_per_user = Math.max(1, Math.floor(Number(body.maxPerUser) || 1));
  }
  if (body.startsAt !== undefined) patch.starts_at = body.startsAt;
  if (body.endsAt !== undefined) patch.ends_at = body.endsAt;
  if (body.note !== undefined) patch.note = body.note;

  try {
    const rows = await sbPatch<Record<string, unknown>[]>(c.env, `vouchers?id=eq.${id}`, patch);
    const voucher = Array.isArray(rows) ? rows[0] : rows;
    if (!voucher) return c.json({ error: 'Voucher tidak ditemukan' }, 404);

    await writeAudit(c.env, a, 'voucher.update', 'voucher', id, patch);
    return c.json({ ok: true, voucher });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal update voucher' }, 500);
  }
});

/**
 * Hapus voucher:
 * - redemptionCount = 0 → hard-delete baris
 * - ada klaim → soft-delete (is_active=false + note flag [deleted])
 * Query force=true → hard-delete meski ada klaim (redemptions ikut cascade)
 */
admin.delete('/vouchers/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (!canMutateBilling(a.role)) {
    return c.json({ error: 'Role tidak boleh menghapus voucher' }, 403);
  }

  const id = c.req.param('id');
  const force = c.req.query('force') === 'true' || c.req.query('force') === '1';

  try {
    type V = { id: string; code: string; is_active: boolean; note: string | null };
    const found = await sbGet<V[]>(c.env, `vouchers?id=eq.${id}&select=id,code,is_active,note&limit=1`);
    const voucher = found[0];
    if (!voucher) return c.json({ error: 'Voucher tidak ditemukan' }, 404);

    const redRows = await sbGet<{ id: string }[]>(
      c.env,
      `voucher_redemptions?voucher_id=eq.${id}&select=id&limit=1000`,
    );
    const redemptionCount = redRows.length;

    if (redemptionCount === 0 || force) {
      await sbDelete(c.env, `vouchers?id=eq.${id}`);
      await writeAudit(c.env, a, 'voucher.delete.hard', 'voucher', id, {
        code: voucher.code,
        redemptionCount,
        force,
      });
      await writeEvent(c.env, {
        type: 'admin.voucher.delete',
        message: `Admin hard-deleted voucher ${voucher.code}`,
        actorUserId: a.userId,
        payload: { code: voucher.code, redemptionCount, force, actorEmail: a.email },
      });
      return c.json({
        ok: true,
        mode: 'hard',
        message: force && redemptionCount > 0
          ? `Voucher ${voucher.code} dihapus permanen (termasuk riwayat klaim via cascade).`
          : `Voucher ${voucher.code} dihapus permanen.`,
      });
    }

    // Soft-delete: nonaktif + flag di note
    const stamp = new Date().toISOString();
    const flag = `[deleted ${stamp.slice(0, 10)}]`;
    const noteBase = (voucher.note || '').replace(/\s*\[deleted[^\]]*\]/gi, '').trim();
    const note = noteBase ? `${noteBase} ${flag}` : flag;

    const rows = await sbPatch<Record<string, unknown>[]>(c.env, `vouchers?id=eq.${id}`, {
      is_active: false,
      note,
      updated_at: stamp,
    });
    const updated = Array.isArray(rows) ? rows[0] : rows;

    await writeAudit(c.env, a, 'voucher.delete.soft', 'voucher', id, {
      code: voucher.code,
      redemptionCount,
    });
    await writeEvent(c.env, {
      type: 'admin.voucher.delete',
      message: `Admin soft-deleted voucher ${voucher.code} (${redemptionCount} klaim)`,
      actorUserId: a.userId,
      payload: { code: voucher.code, redemptionCount, mode: 'soft', actorEmail: a.email },
    });

    return c.json({
      ok: true,
      mode: 'soft',
      redemptionCount,
      voucher: updated,
      message: `Voucher ${voucher.code} dinonaktifkan (soft-delete): sudah ada ${redemptionCount} klaim. Riwayat tetap disimpan.`,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal menghapus voucher' }, 500);
  }
});

export default admin;
