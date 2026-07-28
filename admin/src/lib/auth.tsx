import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { GOOGLE_CLIENT_ID } from './config';
import { adminApi, type AdminMe } from './api';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  me: AdminMe | null;
  loading: boolean;
  error: string | null;
  supabaseReady: boolean;
  googleReady: boolean;
  loginWithGoogleIdToken: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    if (!session?.access_token) {
      setMe(null);
      return;
    }
    try {
      const m = await adminApi.me();
      setMe(m);
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof Error ? e.message : 'Bukan staff admin');
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      void refreshMe();
    } else {
      setMe(null);
    }
  }, [session, refreshMe]);

  const loginWithGoogleIdToken = useCallback(
    async (idToken: string) => {
      if (!supabase) throw new Error('Supabase belum dikonfigurasi (VITE_SUPABASE_*)');
      const { data, error: err } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (err) throw err;
      setSession(data.session);
    },
    [],
  );

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setMe(null);
  }, []);

  const value: AuthState = {
    session,
    me,
    loading,
    error,
    supabaseReady: Boolean(supabase),
    googleReady: Boolean(GOOGLE_CLIENT_ID),
    loginWithGoogleIdToken,
    logout,
    refreshMe,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAdminAuth outside provider');
  return ctx;
}
