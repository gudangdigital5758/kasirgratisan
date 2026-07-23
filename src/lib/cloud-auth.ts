import { jwtDecode } from 'jwt-decode';
import { BRAND } from './brand';
import { getSupabase, isSupabaseAuthConfigured } from './supabase-client';

/**
 * Sesi cloud Profitku.
 *
 * Mode utama (Supabase dikonfigurasi):
 *   - Session disimpan SDK Supabase (auto-refresh)
 *   - API Worker memakai access_token sebagai Bearer
 *
 * Mode legacy (tanpa Supabase):
 *   - Google ID token di localStorage (kompatibel lama)
 */

const LEGACY_TOKEN_KEY = 'profitku_cloud_token_v1';

export interface GoogleIdClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
}

export function isSupabaseMode(): boolean {
  return isSupabaseAuthConfigured;
}

/** Simpan token legacy (Google JWT) — hanya fallback. */
export function saveToken(token: string) {
  localStorage.setItem(LEGACY_TOKEN_KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(LEGACY_TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function decodeClaims(token: string): GoogleIdClaims | null {
  try {
    return jwtDecode<GoogleIdClaims>(token);
  } catch {
    return null;
  }
}

export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const claims = decodeClaims(token);
  if (!claims?.exp) return false;
  return claims.exp * 1000 - 30_000 > Date.now();
}

/**
 * Ambil access token untuk cloud-api (Supabase session atau legacy Google JWT).
 */
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }
  const legacy = loadToken();
  return isTokenValid(legacy) ? legacy : null;
}

export interface CloudUserInfo {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Login dengan Google ID token.
 * 1) Coba supabase.auth.signInWithIdToken
 * 2) Fallback POST /api/auth/google di Worker
 * 3) Legacy: simpan Google JWT langsung
 */
export async function loginWithGoogleIdToken(googleIdToken: string): Promise<{
  accessToken: string;
  user: CloudUserInfo;
}> {
  const sb = getSupabase();

  if (sb) {
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

    // Fallback Worker exchange
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

  // Legacy: tanpa Supabase — simpan Google ID token
  saveToken(googleIdToken);
  const claims = decodeClaims(googleIdToken);
  if (!claims?.sub) throw new Error('Token Google tidak valid');
  return {
    accessToken: googleIdToken,
    user: {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
    },
  };
}

export async function logoutCloud(): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    await sb.auth.signOut();
  }
  clearToken();
}
