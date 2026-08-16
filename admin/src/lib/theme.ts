import { useEffect, useState } from 'react';

const STORAGE_KEY = 'profitku-admin-theme';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Baca preferensi tersimpan ('light' | 'dark' | 'system'); kosong/rusak = system. */
function readStored(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* private mode — abaikan */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Terapkan tema ke <html> sesuai mode; panggil sekali sebelum render untuk hindari flash. */
export function applyAdminTheme(): void {
  if (typeof document === 'undefined') return;
  const mode = readStored();
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

/** Hook tema admin: 3 mode + cycle + persist. Mode system mengikuti perubahan sistem secara live. */
export function useAdminTheme(): { mode: ThemeMode; dark: boolean; cycle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const dark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private mode — abaikan */
    }
  }, [dark, mode]);

  // Cycle: dark → light → system → dark
  const cycle = () => setMode((m) => (m === 'dark' ? 'light' : m === 'light' ? 'system' : 'dark'));

  return { mode, dark, cycle };
}
