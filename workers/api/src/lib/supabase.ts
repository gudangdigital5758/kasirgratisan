import type { Env } from '../env';

/**
 * Minimal Supabase REST helper (tanpa SDK npm agar Worker ringan).
 * Memakai service role di server; RLS di-bypass.
 */

export class SupabaseError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.body = body;
  }
}

function base(env: Env): string {
  if (!env.SUPABASE_URL) throw new SupabaseError('SUPABASE_URL belum dikonfigurasi', 500, null);
  return env.SUPABASE_URL.replace(/\/$/, '');
}

function serviceHeaders(env: Env): HeadersInit {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SupabaseError('SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi', 500, null);
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

export async function sbGet<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${base(env)}/rest/v1/${path}`, {
    headers: serviceHeaders(env),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new SupabaseError(`Supabase GET gagal (${res.status})`, res.status, body);
  }
  return res.json() as Promise<T>;
}

export async function sbPost<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base(env)}/rest/v1/${path}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new SupabaseError(`Supabase POST gagal (${res.status})`, res.status, bodyText);
  }
  return res.json() as Promise<T>;
}

export async function sbPatch<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base(env)}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders(env),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new SupabaseError(`Supabase PATCH gagal (${res.status})`, res.status, bodyText);
  }
  return res.json() as Promise<T>;
}

export async function sbDelete(env: Env, path: string): Promise<void> {
  const res = await fetch(`${base(env)}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: serviceHeaders(env),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new SupabaseError(`Supabase DELETE gagal (${res.status})`, res.status, bodyText);
  }
}

/** Pastikan baris profiles ada (trigger kadang belum jalan di edge cases). */
export async function ensureProfile(
  env: Env,
  user: { id: string; email?: string; name?: string; picture?: string },
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await sbPost(env, 'profiles', {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      picture: user.picture ?? null,
    });
  } catch {
    // conflict = sudah ada
  }
}

/** Validasi JWT Supabase Auth (user access token). */
export async function getUserFromJwt(
  env: Env,
  token: string,
): Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> } | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${base(env)}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string; email?: string; user_metadata?: Record<string, unknown> };
  if (!data?.id) return null;
  return { id: data.id, email: data.email, user_metadata: data.user_metadata };
}
