/**
 * Profitku API — Cron manual/admin (/api/cron/*)
 * Trigger terprogram juga memanggil logika yang sama via scheduled() di index.ts.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { runDunningCron } from '../lib/lifecycle';
import { cleanupExpiredBackups } from '../lib/backups';

const cronRoutes = new Hono<AppEnv>();

/** Cron manual / admin: jalankan dunning sekarang */
cronRoutes.post('/cron/dunning', async (c: AppContext) => {
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const hdr = c.req.header('x-cron-secret') || c.req.header('x-webhook-secret');
    if (hdr !== secret) return c.json({ error: 'Unauthorized' }, 401);
  } else if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock' || c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'WEBHOOK_SECRET wajib di production' }, 403);
  }
  const result = await runDunningCron(c.env);
  return c.json({ ok: true, ...result });
});

/** Cron manual / admin: cleanup backup expired */
cronRoutes.post('/cron/cleanup-backups', async (c: AppContext) => {
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const hdr = c.req.header('x-cron-secret') || c.req.header('x-webhook-secret');
    if (hdr !== secret) return c.json({ error: 'Unauthorized' }, 401);
  } else if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock' || c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'WEBHOOK_SECRET wajib di production' }, 403);
  }
  const result = await cleanupExpiredBackups(c.env, 30);
  return c.json({ ok: true, ...result });
});

export default cronRoutes;
