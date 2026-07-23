import { db } from './db';
import { APP_VERSION } from './app-version';

import { BRAND } from './brand';

const API_URL = `${BRAND.apiOrigin}/webhook/latest-version`;
const TIMEOUT_MS = 5000;

export async function checkVersion(): Promise<void> {
  try {
    const settings = await db.storeSettings.toCollection().first();
    const deviceId = settings?.deviceId ?? 'unknown';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    await fetch(`${API_URL}?installation_id=${encodeURIComponent(deviceId)}&version=${encodeURIComponent(APP_VERSION)}`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch {
    // Silent fail — fire-and-forget
  }
}
