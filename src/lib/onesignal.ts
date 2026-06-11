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

let initialized = false;

/** Apakah platform mendukung push notification (web SDK ini — web/PWA saja). */
export function isPushSupported(): boolean {
  // OneSignal Web SDK tidak berlaku di WebView native (Android pakai plugin
  // terpisah + FCM — ditunda). Jadi push hanya untuk web/PWA dulu.
  if (isNativePlatform()) return false;
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/** Status izin notifikasi browser saat ini. */
export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
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
  withOneSignal((OneSignal) => OneSignal.login(externalId));
}

/** Lepas kaitan device dari user (saat logout). */
export function oneSignalLogout() {
  withOneSignal((OneSignal) => OneSignal.logout());
}

/** Munculkan prompt izin notifikasi browser (dipanggil setelah user setuju di modal). */
export function requestPushPermission() {
  withOneSignal((OneSignal) => OneSignal.Notifications.requestPermission());
}
