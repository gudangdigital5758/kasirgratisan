/**
 * Supabase browser client untuk Auth (Profitku Cloud).
 * Hanya di-init jika VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY terisi.
 */

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const isSupabaseAuthConfigured = Boolean(url && anon);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseAuthConfigured) return null;
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'profitku_supabase_auth',
      },
    });
  }
  return client;
}

export type { Session };
