import { BRAND } from './brand';
import { getSupabase, isSupabaseAuthConfigured } from './supabase-client';

/**
 * Sesi cloud Profitku selalu memakai Supabase Auth. POS offline tidak
 * membutuhkan konfigurasi ini, tetapi fitur cloud menolak login bila Supabase
 * belum dikonfigurasi agar Google ID token tidak pernah diperlakukan sebagai
 * bearer token aplikasi.
 */

const LEGACY_TOKEN_KEY = 'profitku_cloud_token_v1';

export function isSupabaseMode(): boolean {
  return isSupabaseAuthConfigured;
}

/** Hapus token Google JWT dari versi lama; token tersebut tidak lagi dipakai. */
export function clearLegacyToken(): void {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

/** Ambil access token Supabase untuk request Worker. */
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

export interface CloudUserInfo {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Login dengan Google ID token melalui Supabase Auth, lalu fallback ke Worker
 * hanya untuk pertukaran sesi Supabase yang tervalidasi.
 */
export async function loginWithGoogleIdToken(googleIdToken: string): Promise<{
  accessToken: string;
  user: CloudUserInfo;
}> {
  const sb = getSupabase();
  if (!sb) {
    throw new Error('Profitku Cloud membutuhkan konfigurasi Supabase. POS offline tetap dapat digunakan.');
  }

  const { data, error } = await sb.auth.signInWithIdToken({
    provider: 'google',
    token: googleIdToken,
  });

  if (!error && data.session) {
    const u = data.session.user;
    const meta = u.user_metadata ?? {};
    return {
      accessToken: data.session.access_token,
      user: {
        id: u.id,
        email: u.email,
        name: (meta.full_name as string) || (meta.name as string) || undefined,
        picture: (meta.avatar_url as string) || (meta.picture as string) || undefined,
      },
    };
  }

  // Fallback Worker exchange still returns a Supabase access/refresh session.
  console.warn('[cloud-auth] signInWithIdToken gagal, coba Worker exchange:', error?.message);
  const base = (
    import.meta.env.VITE_AUTH_API_URL ||
    (import.meta.env.DEV ? 'http://127.0.0.1:8787' : BRAND.apiOrigin)
  ).replace(/\/$/, '');

  const res = await fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: googleIdToken }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    session?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
    };
  };
  if (!res.ok || !json.session) {
    throw new Error(json.error || error?.message || 'Login Supabase gagal');
  }

  await sb.auth.setSession({
    access_token: json.session.access_token,
    refresh_token: json.session.refresh_token,
  });

  const meta = json.session.user.user_metadata ?? {};
  return {
    accessToken: json.session.access_token,
    user: {
      id: json.session.user.id,
      email: json.session.user.email,
      name: (meta.full_name as string) || (meta.name as string) || undefined,
      picture: (meta.avatar_url as string) || (meta.picture as string) || undefined,
    },
  };
}

export async function logoutCloud(): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    await sb.auth.signOut();
  }
  clearLegacyToken();
}
