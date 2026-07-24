/**
 * Profitku Admin API — staff only (/admin/api/*)
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPatch, sbPost } from '../lib/supabase';
import {
  canMutateBilling,
  canWrite,
  requireAdmin,
  writeAudit,
  writeEvent,
  type AdminContext,
} from '../lib/admin';
import { CLOUD_PLAN_PRICE_IDR } from '../data/seed-plans';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

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

    const [profiles, activeSubs, payments, backups24h] = await Promise.all([
      sbGet<Prof[]>(c.env, 'profiles?select=id'),
      sbGet<Sub[]>(
        c.env,
        `subscriptions?status=in.(active,trialing)&current_period_end=gt.${now}&select=id,status,current_period_end`,
      ),
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
    const subs = await sbGet<Sub[]>(
      c.env,
      `subscriptions?user_id=in.(${ids.join(',')})&status=in.(active,trialing)&current_period_end=gt.${now}&select=user_id,status,current_period_end,plan_id`,
    );
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
    return c.json({ payments: rows });
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

admin.get('/settings', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  let settings: Record<string, unknown> = {};
  try {
    type Row = { key: string; value: unknown; updated_at: string };
    const rows = await sbGet<Row[]>(c.env, 'platform_settings?select=key,value,updated_at');
    for (const r of rows) settings[r.key] = r.value;
  } catch {
    settings = { _warning: 'platform_settings belum ada — jalankan migrasi admin_ops' };
  }

  return c.json({
    settings,
    health: {
      supabase: Boolean(c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY),
      resend: Boolean(c.env.RESEND_API_KEY),
      fonnte: Boolean(c.env.FONNTE_TOKEN),
      paymentProvider: c.env.PAYMENT_PROVIDER || 'mock',
      adminAllowlistConfigured: Boolean(c.env.ADMIN_EMAILS),
    },
    secretsNote:
      'Token Fonnte/Resend/payment/service role hanya di Cloudflare secrets — tidak bisa diedit dari admin UI.',
  });
});

admin.patch('/settings', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (a.role !== 'superadmin' && a.role !== 'support') {
    return c.json({ error: 'Hanya superadmin/support yang boleh ubah settings' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowed = ['maintenance_mode', 'dunning_enabled', 'mock_payment_note'] as const;
  const updates: string[] = [];

  try {
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      await sbPost(c.env, 'platform_settings', {
        key,
        value: body[key],
        updated_at: new Date().toISOString(),
        updated_by: a.userId,
      }).catch(async () => {
        // upsert via patch
        await sbPatch(c.env, `platform_settings?key=eq.${key}`, {
          value: body[key],
          updated_at: new Date().toISOString(),
          updated_by: a.userId,
        });
      });
      updates.push(key);
    }

    await writeAudit(c.env, a, 'settings.update', 'platform_settings', null, {
      keys: updates,
      body,
    });

    return c.json({ ok: true, updated: updates });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal simpan settings' }, 500);
  }
});

export default admin;
