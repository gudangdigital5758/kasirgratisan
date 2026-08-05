/**
 * Wrapper tipis OneSignal Web SDK v16 (push notification).
 *
 * SDK dimuat lewat pola deferred (window.OneSignalDeferred) — tanpa dependency
 * npm. OneSignal diberi scope service worker terpisah (`/push/`) supaya tidak
 * bentrok dengan service worker PWA (Workbox) yang ada di scope `/`.
 *
 * Push hanya untuk user yang login Google: panggil oneSignalLogin(profile.user.id)
 * setelah profil diambil, dan oneSignalLogout() saat logout.
 */

import { isNativePlatform } from '@/lib/printer';

interface OneSignalApi {
  init(opts: Record<string, unknown>): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: {
    permission: boolean;
    requestPermission(): Promise<void>;
  };
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalApi) => void | Promise<void>>;
  }
}

const APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined;

/** API minimal modul native @onesignal/capacitor-plugin yang dipakai aplikasi. */
interface NativeOneSignal {
  initialize: (appId: string) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Notifications: {
    requestPermission: (fallbackToSettings?: boolean) => Promise<boolean>;
    hasPermission: () => Promise<boolean>;
  };
}

let initialized = false;
let initPromise: Promise<NativeOneSignal> | null = null;

async function ensureNativeOneSignal(): Promise<NativeOneSignal> {
  if (!APP_ID) {
    throw new Error('OneSignal App ID is not configured');
  }

  if (!initPromise) {
    initPromise = (async () => {
      const { default: OneSignal } = await import('@onesignal/capacitor-plugin');
      await OneSignal.initialize(APP_ID);
      return OneSignal;
    })();
  }

  return initPromise;
}

/** Apakah platform mendukung push notification. */
export function isPushSupported(): boolean {
  if (!APP_ID) return false;
  if (isNativePlatform()) return true;
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/** Status izin notifikasi browser saat ini (hanya untuk Web). */
export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  if (isNativePlatform()) {
    // Pada platform native, status dicek secara asinkron di komponen/hook
    return 'default';
  }
  return Notification.permission;
}

function withOneSignal(cb: (os: OneSignalApi) => void | Promise<void>) {
  if (!APP_ID) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(cb);
}

/** Muat & inisialisasi OneSignal sekali. No-op bila App ID kosong / tak didukung. */
export function initOneSignal() {
  if (initialized || !APP_ID || !isPushSupported()) return;
  initialized = true;

  if (isNativePlatform()) {
    ensureNativeOneSignal().catch((err) => {
      console.error('Gagal inisialisasi native OneSignal:', err);
    });
    return;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];

  const script = document.createElement('script');
  script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  script.defer = true;
  document.head.appendChild(script);

  withOneSignal(async (OneSignal) => {
    await OneSignal.init({
      appId: APP_ID,
      // Scope terpisah agar tidak menimpa service worker PWA di '/'.
      serviceWorkerParam: { scope: '/push/' },
      serviceWorkerPath: 'push/OneSignalSDKWorker.js',
      allowLocalhostAsSecureOrigin: true,
    });
  });
}

/** Kaitkan device ke user (External ID = profile.user.id, mis. "google-12345"). */
export function oneSignalLogin(externalId: string) {
  if (!APP_ID) return;

  if (isNativePlatform()) {
    ensureNativeOneSignal()
      .then((OneSignal) => {
        return OneSignal.login(externalId);
      })
      .catch((err) => {
        console.error('Gagal login native OneSignal:', err);
      });
    return;
  }
  withOneSignal((OneSignal) => OneSignal.login(externalId));
}

/** Lepas kaitan device dari user (saat logout). */
export function oneSignalLogout() {
  if (!APP_ID) return;

  if (isNativePlatform()) {
    ensureNativeOneSignal()
      .then((OneSignal) => {
        return OneSignal.logout();
      })
      .catch((err) => {
        console.error('Gagal logout native OneSignal:', err);
      });
    return;
  }
  withOneSignal((OneSignal) => OneSignal.logout());
}

/** Munculkan prompt izin notifikasi browser/native (dipanggil setelah user setuju di modal). */
export function requestPushPermission() {
  if (!APP_ID) return;

  if (isNativePlatform()) {
    ensureNativeOneSignal()
      .then((OneSignal) => {
        return OneSignal.Notifications.requestPermission(true);
      })
      .catch((err) => {
        console.error('Gagal meminta izin notifikasi native:', err);
      });
    return;
  }
  withOneSignal((OneSignal) => OneSignal.Notifications.requestPermission());
}

/** Cek status izin notifikasi native (aman & terinisialisasi). */
export async function checkPushPermissionNative(): Promise<boolean> {
  if (!APP_ID) return true; // Anggap "sudah di-handle" jika tidak ada APP_ID
  try {
    const OneSignal = await ensureNativeOneSignal();
    return await OneSignal.Notifications.hasPermission();
  } catch (err) {
    console.error('Gagal memeriksa izin notifikasi native:', err);
    return true; // Anggap true jika error agar tidak memunculkan modal yang tidak berguna
  }
}
