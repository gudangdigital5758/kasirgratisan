import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type User, type PermissionKey } from '@/lib/db';
import {
  hasPermission as checkPermission,
  restoreSession,
  saveSession as persistSession,
  clearSession as clearStoredSession,
  login as authLogin,
  loginCloud as authLoginCloud,
  type LoginResult,
} from '@/lib/auth';
import {
  loadCloudMemberSession,
  saveCloudMemberSession,
  clearCloudMemberSession,
  permissionsForCloudRole,
} from '@/lib/cloud-team';

interface AuthContextValue {
  // Whether multi-user mode is active. When false, app behaves like before
  // (single-user / legacy mode) — `currentUser` is null and `can()` always returns true.
  multiUserEnabled: boolean;
  // Whether we're still loading session/settings on first paint.
  loading: boolean;
  // Logged-in user, or null when in legacy mode or not yet logged in.
  currentUser: User | null;
  // Permission check: returns true in legacy mode, otherwise checks user perms.
  can: (key: PermissionKey) => boolean;
  // Owner-only flag (manage users, toggle multi-user, etc.)
  isOwner: boolean;
  login: (username: string, pin: string) => Promise<LoginResult>;
  /** Login anggota tim cloud (email + PIN dari dashboard). */
  loginCloud: (email: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
  // Refresh currentUser from DB (e.g. after permission changes).
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);

  const multiUserEnabled = !!storeSettings?.multiUserEnabled;

  // Restore session on mount (only matters if multi-user is on).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user = await restoreSession();
      if (!user) {
        // Coba session login cloud (cache offline 7 hari).
        const settings = await db.storeSettings.toCollection().first();
        const cloudStoreId = settings?.cloudStoreId;
        const sess = cloudStoreId ? loadCloudMemberSession(cloudStoreId) : null;
        if (sess) {
          user = {
            username: sess.username,
            pinHash: '',
            name: sess.name || sess.username,
            role: 'staff',
            permissions: permissionsForCloudRole(sess.role),
            isActive: 1,
            createdAt: new Date(),
            lastLoginAt: new Date(),
          };
        }
      }
      if (!cancelled) {
        setCurrentUser(user);
        setSessionRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-refresh the in-memory user when their row changes (permission edit etc.).
  // We bind to the DB row by id so updates from User Management page propagate.
  useEffect(() => {
    if (!currentUser?.id) return;
    const id = currentUser.id;
    // Dexie tidak mencantumkan unsubscribe utk hook 'updating' di tipenya,
    // padahal runtime mengembalikan fungsi penghapus — cast agar aman.
    const sub = db.users.hook('updating', (mods, primKey) => {
      if (primKey === id) {
        // Defer so the update is committed first, then re-read.
        queueMicrotask(async () => {
          const fresh = await db.users.get(id);
          if (!fresh || !fresh.isActive) {
            // Account deactivated → kick out
            clearStoredSession();
            setCurrentUser(null);
            return;
          }
          setCurrentUser(fresh);
        });
      }
    }) as unknown as () => void;
    return () => {
      db.users.hook('updating').unsubscribe(sub);
    };
  }, [currentUser?.id]);

  const login = useCallback(async (username: string, pin: string): Promise<LoginResult> => {
    const result = await authLogin(username, pin);
    if (result.ok && result.user?.id) {
      const settings = await db.storeSettings.toCollection().first();
      if (settings?.deviceId) {
        persistSession(result.user.id, settings.deviceId);
      }
      setCurrentUser(result.user);
    }
    return result;
  }, []);

  const loginCloud = useCallback(async (email: string, pin: string): Promise<LoginResult> => {
    const settings = await db.storeSettings.toCollection().first();
    const storeId = settings?.cloudStoreId;
    if (!storeId) {
      return { ok: false, error: 'Device ini belum terhubung ke toko cloud' };
    }
    const result = await authLoginCloud(email, pin, storeId);
    if (result.ok && result.user) {
      saveCloudMemberSession(storeId, {
        username: result.user.username,
        name: result.user.name,
        role: result.cloudRole ?? 'karyawan',
      });
      setCurrentUser(result.user);
    }
    return result;
  }, []);

  const logout = useCallback(() => {
    clearStoredSession();
    clearCloudMemberSession();
    setCurrentUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!currentUser?.id) return;
    const fresh = await db.users.get(currentUser.id);
    if (!fresh || !fresh.isActive) {
      clearStoredSession();
      setCurrentUser(null);
      return;
    }
    setCurrentUser(fresh);
  }, [currentUser?.id]);

  const can = useCallback(
    (key: PermissionKey): boolean => {
      // Legacy / single-user mode: everything is allowed (backwards compatible).
      if (!multiUserEnabled) return true;
      return checkPermission(currentUser, key);
    },
    [multiUserEnabled, currentUser]
  );

  const isOwner = !multiUserEnabled || currentUser?.role === 'owner';

  // Loading: still waiting on storeSettings or first session restore attempt.
  const loading = storeSettings === undefined || !sessionRestored;

  const value: AuthContextValue = {
    multiUserEnabled,
    loading,
    currentUser,
    can,
    isOwner,
    login,
    loginCloud,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
