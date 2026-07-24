import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { GOOGLE_CLIENT_ID, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { adminApi, setAdminTokenGetter } from './api';

type AdminMe = {
  userId: string;
  email: string;
  role: string;
  canWrite: boolean;
  canMutateBilling: boolean;
};

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

function makeClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storageKey: 'profitku_admin_supabase_auth',
      autoRefreshToken: true,
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => makeClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAdminTokenGetter(() => session?.access_token ?? null);
  }, [session]);

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
  }, [supabase]);

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
    [supabase],
  );

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setMe(null);
  }, [supabase]);

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
