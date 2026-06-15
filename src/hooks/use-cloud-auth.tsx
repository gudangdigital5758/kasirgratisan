import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import {
  setCloudTokenGetter,
  fetchProfile,
  type UserProfile,
} from '@/lib/cloud-api';
import {
  saveToken,
  loadToken,
  clearToken,
  decodeClaims,
  isTokenValid,
} from '@/lib/cloud-auth';
import { initOneSignal, oneSignalLogin, oneSignalLogout } from '@/lib/onesignal';
import { nativeGoogleSignOut } from '@/lib/google-auth';
import { isNativePlatform } from '@/lib/printer';

interface GoogleUser {
  email?: string;
  name?: string;
  picture?: string;
}

interface CloudAuthValue {
  token: string | null;
  googleUser: GoogleUser | null;
  profile: UserProfile | null;
  loadingProfile: boolean;
  isLoggedIn: boolean;
  isSubscribed: boolean;
  isSyncSubscribed: boolean;
  login: (idToken: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthValue | null>(null);

export function CloudAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Ref agar getter token yang didaftarkan ke cloud-api selalu mengembalikan
  // nilai terkini tanpa perlu re-register.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    setCloudTokenGetter(() => tokenRef.current);
    initOneSignal(); // muat SDK push sekali (no-op bila App ID kosong)
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!tokenRef.current) return;
    setLoadingProfile(true);
    try {
      const p = await fetchProfile();
      setProfile(p);
      // Kaitkan device push ke user Google (pakai user.id ber-prefix dari backend,
      // bukan `sub` token).
      if (p.user?.id) oneSignalLogin(p.user.id);
    } catch {
      setProfile(null);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const applyToken = useCallback((idToken: string) => {
    setToken(idToken);
    tokenRef.current = idToken;
    const claims = decodeClaims(idToken);
    setGoogleUser(claims ? { email: claims.email, name: claims.name, picture: claims.picture } : null);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    tokenRef.current = null;
    setGoogleUser(null);
    setProfile(null);
    oneSignalLogout();
    if (isNativePlatform()) nativeGoogleSignOut();
  }, []);

  const login = useCallback(
    async (idToken: string) => {
      saveToken(idToken);
      applyToken(idToken);
      await refreshProfile();
    },
    [applyToken, refreshProfile],
  );

  // Restore token saat mount.
  useEffect(() => {
    const saved = loadToken();
    if (isTokenValid(saved)) {
      applyToken(saved!);
      refreshProfile();
    } else if (saved) {
      // Token kadaluarsa — bersihkan, user perlu login ulang.
      clearToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: CloudAuthValue = {
    token,
    googleUser,
    profile,
    loadingProfile,
    isLoggedIn: !!token,
    isSubscribed: !!profile?.subscription?.hasActiveSubscription,
    isSyncSubscribed: !!profile?.syncSubscription?.hasActiveSubscription,
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
