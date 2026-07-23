/**
 * Tukar Google ID token → sesi Supabase (server-side fallback).
 * Preferensi client: supabase.auth.signInWithIdToken di browser.
 *
 * Endpoint Worker memakai Admin API + generateLink / atau verify + magic session.
 * Cara stabil: Auth signInWithIdToken via GoTrue REST.
 */

import type { Env } from '../env';
import { ensureProfile } from './supabase';

export interface SupabaseSessionPayload {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
}

/**
 * POST /auth/v1/token?grant_type=id_token
 * Body: { provider: 'google', id_token }
 */
export async function exchangeGoogleIdToken(
  env: Env,
  googleIdToken: string,
): Promise<{ session: SupabaseSessionPayload } | { error: string; status: number }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { error: 'Supabase Auth belum dikonfigurasi di Worker', status: 503 };
  }

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/auth/v1/token?grant_type=id_token`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'google',
      id_token: googleIdToken,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as SupabaseSessionPayload & {
    error?: string;
    error_description?: string;
    msg?: string;
  };

  if (!res.ok || !data.access_token) {
    return {
      error: data.error_description || data.msg || data.error || `Auth gagal (${res.status})`,
      status: res.status >= 400 ? res.status : 401,
    };
  }

  const meta = data.user?.user_metadata ?? {};
  await ensureProfile(env, {
    id: data.user.id,
    email: data.user.email,
    name: (meta.full_name as string) || (meta.name as string) || undefined,
    picture: (meta.avatar_url as string) || (meta.picture as string) || undefined,
  });

  return {
    session: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type || 'bearer',
      user: data.user,
    },
  };
}
