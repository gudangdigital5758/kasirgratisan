import { Hono } from 'hono';
import type { Env } from '../env';
import { canWrite, requireAdmin, writeAudit, writeEvent } from '../lib/admin';
import { sbGet, sbPatch, sbPost } from '../lib/supabase';
import { validateActionButtons, validatePlatformSettings } from '../lib/settings-validation';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

settings.get('/settings', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  let values: Record<string, unknown> = {};
  try {
    type Row = { key: string; value: unknown; updated_at: string };
    const rows = await sbGet<Row[]>(c.env, 'platform_settings?select=key,value,updated_at');
    for (const row of rows) values[row.key] = row.value;
  } catch {
    values = { _warning: 'platform_settings belum ada — jalankan migrasi admin_ops' };
  }

  return c.json({
    settings: values,
    health: {
      supabase: Boolean(c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY),
      resend: Boolean(c.env.RESEND_API_KEY),
      fonnte: Boolean(c.env.FONNTE_TOKEN),
      paymentProvider: c.env.PAYMENT_PROVIDER || 'mock',
      adminAllowlistConfigured: Boolean(c.env.ADMIN_EMAILS),
    },
    capabilities: {
      canWritePlatformSettings: admin.role === 'superadmin' || admin.role === 'support',
      canWriteAppSettings: canWrite(admin.role),
    },
    secretsNote:
      'Token Fonnte/Resend/payment/service role hanya di Cloudflare secrets — tidak bisa diedit dari admin UI.',
  });
});

settings.patch('/settings', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  if (admin.role !== 'superadmin' && admin.role !== 'support') {
    return c.json({ error: 'Hanya superadmin/support yang boleh ubah settings' }, 403);
  }

  const parsed = (await c.req.json().catch(() => null)) as unknown;
  const validationError = validatePlatformSettings(parsed);
  if (validationError) return c.json({ error: validationError }, 400);
  const body = parsed as Record<string, unknown>;

  const allowed = ['maintenance_mode', 'dunning_enabled', 'mock_payment_note'] as const;
  const updates: string[] = [];
  try {
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      const update = {
        value: body[key],
        updated_at: new Date().toISOString(),
        updated_by: admin.userId,
      };
      await sbPost(c.env, 'platform_settings', { key, ...update }).catch(() =>
        sbPatch(c.env, `platform_settings?key=eq.${key}`, update),
      );
      updates.push(key);
    }

    await writeAudit(c.env, admin, 'settings.update', 'platform_settings', null, {
      keys: updates,
      body,
    });
    return c.json({ ok: true, updated: updates });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Gagal simpan settings' }, 500);
  }
});

settings.put('/app-settings/:key', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  if (!canWrite(admin.role)) {
    return c.json({ error: 'Role tidak boleh mengubah app settings' }, 403);
  }

  const key = c.req.param('key');
  if (key !== 'action_buttons') {
    return c.json({ error: `Key '${key}' tidak diizinkan untuk diubah` }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
  if (body.value === undefined) return c.json({ error: 'Field value wajib ada' }, 400);
  const validationError = validateActionButtons(body.value);
  if (validationError) return c.json({ error: validationError }, 400);

  try {
    const rows = await sbPatch<{ key: string; value: unknown; updated_at: string }[]>(
      c.env,
      `app_settings?key=eq.${key}`,
      {
        value: body.value,
        updated_at: new Date().toISOString(),
        updated_by: admin.userId,
      },
    );
    const setting = rows[0];
    if (!setting) return c.json({ error: `Setting key '${key}' tidak ditemukan di database` }, 404);

    await writeAudit(
      c.env,
      admin,
      'app_settings.update',
      'app_settings',
      key,
      { value: body.value },
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    );
    await writeEvent(c.env, {
      type: 'admin.app_settings.update',
      message: `Admin updated app_settings key=${key}`,
      actorUserId: admin.userId,
      payload: { key, actorEmail: admin.email },
    });
    return c.json({
      ok: true,
      setting: { key: setting.key, value: setting.value, updatedAt: setting.updated_at },
    });
  } catch (err) {
    console.error('[admin app-settings update]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal update app settings' }, 500);
  }
});

export default settings;