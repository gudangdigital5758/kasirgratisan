import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

/** null = ikuti preferensi sistem; true = gelap; false = terang. */
export type DarkMode = boolean | null;

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Terapkan class `dark` ke <html> sesuai pilihan (atau sistem). */
export function applyDarkMode(darkMode: DarkMode): void {
  if (typeof document === 'undefined') return;
  const dark = darkMode ?? systemPrefersDark();
  document.documentElement.classList.toggle('dark', dark);
}

/** Hook dark mode POS: baca preferensi dari storeSettings, terapkan + simpan. */
export function useDarkMode(): {
  darkMode: DarkMode;
  setDarkMode: (value: DarkMode) => Promise<void>;
} {
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  const darkMode: DarkMode = storeSettings?.darkMode ?? null;

  useEffect(() => {
    applyDarkMode(darkMode);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      // Saat mode "sistem", ikuti perubahan live.
      if (storeSettings?.darkMode == null) applyDarkMode(null);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [darkMode, storeSettings?.darkMode]);

  const setDarkMode = async (value: DarkMode) => {
    const settings = await db.storeSettings.toCollection().first();
    if (settings?.id) {
      await db.storeSettings.update(settings.id, { darkMode: value });
    }
    applyDarkMode(value);
  };

  return { darkMode, setDarkMode };
}
