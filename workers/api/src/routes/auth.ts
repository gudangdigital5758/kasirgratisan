/**
 * Profitku API — Auth (/api/auth/*)
 */
import { Hono } from 'hono';
import type { AppEnv } from './helpers';
import { exchangeGoogleIdToken } from '../lib/auth-google';

const authRoutes = new Hono<AppEnv>();

/** Tukar Google ID token → sesi Supabase (fallback bila client signInWithIdToken gagal). */
authRoutes.post('/auth/google', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { idToken?: string };
  if (!body.idToken) return c.json({ error: 'idToken wajib' }, 400);
  const result = await exchangeGoogleIdToken(c.env, body.idToken);
  if ('error' in result) {
    const code = (result.status === 401 || result.status === 403 || result.status === 503
      ? result.status
      : 400) as 400 | 401 | 403 | 503;
    return c.json({ error: result.error }, code);
  }
  return c.json({ session: result.session });
});

export default authRoutes;
