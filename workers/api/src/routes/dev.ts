/**
 * Profitku API — Dev helper (/api/dev/*) — hanya aktif di mode mock.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { sendEmail, sendPush, sendWhatsApp } from '../lib/notify';

const devRoutes = new Hono<AppEnv>();

// Test notify (lindungi di production)
devRoutes.post('/dev/notify-test', async (c: AppContext) => {
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

export default devRoutes;
