import { useEffect, useState } from 'react';

const STORAGE_KEY = 'profitku-admin-theme';

/** Terapkan tema (light/dark) ke <html>; panggil sekali sebelum render untuk hindari flash. */
export function applyAdminTheme(): void {
  if (typeof document === 'undefined') return;
  let dark = false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    dark =
      saved === 'dark' ||
      (!saved && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  } catch {
    dark = false;
  }
  document.documentElement.classList.toggle('dark', dark);
}

/** Hook tema admin: state + toggle + persist. */
export function useAdminTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      /* private mode — abaikan */
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
