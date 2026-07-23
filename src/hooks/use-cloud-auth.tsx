import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import {
  setCloudTokenGetter,
  fetchProfile,
  type UserProfile,
} from '@/lib/cloud-api';
import {
  getAccessToken,
  loginWithGoogleIdToken,
  logoutCloud,
  isSupabaseMode,
  loadToken,
  isTokenValid,
  decodeClaims,
  type CloudUserInfo,
} from '@/lib/cloud-auth';
import { getSupabase } from '@/lib/supabase-client';
import { initOneSignal, oneSignalLogin, oneSignalLogout } from '@/lib/onesignal';
import { nativeGoogleSignOut } from '@/lib/google-auth';
import { isNativePlatform } from '@/lib/printer';

interface CloudAuthValue {
  token: string | null;
  googleUser: CloudUserInfo | null;
  profile: UserProfile | null;
  loadingProfile: boolean;
  isLoggedIn: boolean;
  isSubscribed: boolean;
  isSyncSubscribed: boolean;
  /** true jika memakai Supabase Auth (bukan Google JWT legacy) */
  authMode: 'supabase' | 'legacy';
  login: (googleIdToken: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthValue | null>(null);

export function CloudAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [googleUser, setGoogleUser] = useState<CloudUserInfo | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    // Getter async-aware: cloud-api sync getter — refresh dari ref dulu,
    // Supabase auto-refresh mengisi session di background.
    setCloudTokenGetter(() => tokenRef.current);
    initOneSignal();
  }, []);

  const refreshProfile = useCallback(async () => {
    const access = tokenRef.current ?? (await getAccessToken());
    if (!access) return;
    if (access !== tokenRef.current) {
      tokenRef.current = access;
      setToken(access);
    }
    setLoadingProfile(true);
    try {
      const p = await fetchProfile();
      setProfile(p);
      if (p.user?.id) oneSignalLogin(p.user.id);
    } catch {
      setProfile(null);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const applySession = useCallback((accessToken: string, user: CloudUserInfo) => {
    setToken(accessToken);
    tokenRef.current = accessToken;
    setGoogleUser(user);
  }, []);

  const logout = useCallback(() => {
    void logoutCloud();
    setToken(null);
    tokenRef.current = null;
    setGoogleUser(null);
    setProfile(null);
    oneSignalLogout();
    if (isNativePlatform()) void nativeGoogleSignOut();
  }, []);

  const login = useCallback(
    async (googleIdToken: string) => {
      const { accessToken, user } = await loginWithGoogleIdToken(googleIdToken);
      applySession(accessToken, user);
      await refreshProfile();
    },
    [applySession, refreshProfile],
  );

  // Restore session on mount
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          const u = data.session.user;
          const meta = u.user_metadata ?? {};
          applySession(data.session.access_token, {
            id: u.id,
            email: u.email,
            name: (meta.full_name as string) || (meta.name as string) || undefined,
            picture: (meta.avatar_url as string) || (meta.picture as string) || undefined,
          });
          await refreshProfile();
        }

        const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
          if (cancelled) return;
          if (session) {
            const u = session.user;
            const meta = u.user_metadata ?? {};
            applySession(session.access_token, {
              id: u.id,
              email: u.email,
              name: (meta.full_name as string) || (meta.name as string) || undefined,
              picture: (meta.avatar_url as string) || (meta.picture as string) || undefined,
            });
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              await refreshProfile();
            }
          } else if (event === 'SIGNED_OUT') {
            setToken(null);
            tokenRef.current = null;
            setGoogleUser(null);
            setProfile(null);
          }
        });
        unsub = () => sub.subscription.unsubscribe();
        return;
      }

      // Legacy restore
      const saved = loadToken();
      if (isTokenValid(saved)) {
        const claims = decodeClaims(saved!);
        if (claims) {
          applySession(saved!, {
            id: claims.sub,
            email: claims.email,
            name: claims.name,
            picture: claims.picture,
          });
          await refreshProfile();
        }
      } else if (saved) {
        const { clearToken } = await import('@/lib/cloud-auth');
        clearToken();
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jaga tokenRef sinkron saat Supabase refresh (periodik)
  useEffect(() => {
    if (!isSupabaseMode()) return;
    const id = window.setInterval(async () => {
      const t = await getAccessToken();
      if (t && t !== tokenRef.current) {
        tokenRef.current = t;
        setToken(t);
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hasCloud =
    !!profile?.subscription?.hasActiveSubscription ||
    !!profile?.syncSubscription?.hasActiveSubscription;

  const value: CloudAuthValue = {
    token,
    googleUser,
    profile,
    loadingProfile,
    isLoggedIn: !!token,
    isSubscribed: hasCloud,
    isSyncSubscribed: hasCloud,
    authMode: isSupabaseMode() ? 'supabase' : 'legacy',
    login,
    logout,
    refreshProfile,
  };

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

export function useCloudAuth(): CloudAuthValue {
  const ctx = useContext(CloudAuthContext);
  if (!ctx) throw new Error('useCloudAuth must be used within CloudAuthProvider');
  return ctx;
}
