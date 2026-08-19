/**
 * Profitku API — Cron manual/admin (/api/cron/*)
 * Trigger terprogram juga memanggil logika yang sama via scheduled() di index.ts.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { runDunningCron, flagStalePendingPayments } from '../lib/lifecycle';
import { cleanupExpiredBackups } from '../lib/backups';
import { verifyCronHmac } from '../lib/cron-auth';

const cronRoutes = new Hono<AppEnv>();

/**
 * Auth untuk trigger cron manual.
 * - CRON_HMAC_SECRET ada: wajib HMAC timestamped; header secret lama ditolak.
 * - Masa transisi: WEBHOOK_SECRET header lama tetap bekerja bila key HMAC belum
 *   di-install, agar deploy tidak memutus operasional.
 * - Production tanpa kedua secret: fail closed.
 */
async function authorizeCron(c: AppContext): Promise<Response | null> {
  if (c.env.CRON_HMAC_SECRET) {
    if (await verifyCronHmac(c.env, c.req.raw)) return null;
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const header = c.req.header('x-cron-secret') || c.req.header('x-webhook-secret');
    if (header === secret) return null;
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if ((c.env.PAYMENT_PROVIDER || 'mock') !== 'mock' || c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'CRON_HMAC_SECRET wajib di production' }, 403);
  }
  return null;
}

/** Cron manual / admin: jalankan dunning sekarang */
cronRoutes.post('/cron/dunning', async (c: AppContext) => {
  const denied = await authorizeCron(c);
  if (denied) return denied;
  const result = await runDunningCron(c.env);
  return c.json({ ok: true, ...result });
});

/** Cron manual / admin: cleanup backup expired */
cronRoutes.post('/cron/cleanup-backups', async (c: AppContext) => {
  const denied = await authorizeCron(c);
  if (denied) return denied;
  const result = await cleanupExpiredBackups(c.env, 30);
  return c.json({ ok: true, ...result });
});

/** Cron manual / admin: deteksi payment PENDING menggantung (> 48 jam) */
cronRoutes.post('/cron/stale-pending', async (c: AppContext) => {
  const denied = await authorizeCron(c);
  if (denied) return denied;
  const result = await flagStalePendingPayments(c.env);
  return c.json({ ok: true, ...result });
});

export default cronRoutes;
