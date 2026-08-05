/**
 * Pelaporan error client (otomatis, throttled, tanpa dependency eksternal).
 *
 * Mengirim error tak-tertangkap (window.onerror / unhandledrejection / React
 * error boundary) ke `POST /webhook/client-error` Worker, yang menuliskannya ke
 * tabel `platform_events` (terlihat di admin console) — TANPA email spam.
 *
 * Privasi: pesan & stack dibatasi panjang dan URL di-strip query string-nya.
 * Hanya aktif di production (import.meta.env.PROD).
 */

import { BRAND } from './brand';
import { APP_VERSION } from './app-version';

interface ClientErrorPayload {
  type: 'error' | 'unhandledrejection' | 'react';
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  appVersion: string;
}

const MIN_INTERVAL_MS = 60_000; // maks 1 laporan/menit per tab
const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

let lastReportAt = 0;

/** Buang query string/hash dari URL di stack (privasi). */
function stripUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s)'"]+)/g, (m) => {
    try {
      const u = new URL(m);
      return u.origin + u.pathname;
    } catch {
      return m;
    }
  });
}

/** Kirim laporan (fire-and-forget, keepalive agar tidak hilang saat close tab). */
function send(payload: ClientErrorPayload): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  fetch(`${BRAND.apiOrigin}/webhook/client-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
    keepalive: true,
  })
    .catch(() => {
      /* fire-and-forget */
    })
    .finally(() => clearTimeout(timer));
}

export function reportError(
  type: ClientErrorPayload['type'],
  error: unknown,
  componentStack?: string,
): void {
  if (!import.meta.env.PROD) return;
  const now = Date.now();
  if (now - lastReportAt < MIN_INTERVAL_MS) return;
  lastReportAt = now;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  send({
    type,
    message: message.slice(0, MAX_MESSAGE),
    stack: stack ? stripUrls(stack).slice(0, MAX_STACK) : undefined,
    componentStack: componentStack ? stripUrls(componentStack).slice(0, MAX_STACK) : undefined,
    url: typeof location !== 'undefined' ? location.pathname : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    appVersion: APP_VERSION,
  });
}

/** Pasang listener global (hanya sekali, production). */
export function initErrorReporting(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    reportError('error', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError('unhandledrejection', e.reason);
  });
}
