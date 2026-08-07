import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Palette, ChevronLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import ThemeColorPicker from '@/components/ThemeColorPicker';
import { setThemeColor } from '@/hooks/use-theme-color';
import { useDarkMode } from '@/hooks/use-dark-mode';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';

export default function ThemeSettings() {
  const { t } = useTranslation('settings');
  const { can } = useAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const { darkMode, setDarkMode } = useDarkMode();

  if (!can('manage_store_settings')) {
    return <LockedPage title={t('masterData.theme.title')} permissionLabel={t('masterData.theme.permissionLabel')} />;
  }

  const modes = [
    { value: false as const, label: t('masterData.theme.darkModeLight') },
    { value: true as const, label: t('masterData.theme.darkModeDark') },
    { value: null as const, label: t('masterData.theme.darkModeSystem') },
  ];

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary" />
          {t('masterData.theme.title')}
        </h1>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">{t('masterData.theme.color')}</p>
            <ThemeColorPicker
              value={storeSettings?.themeColor ?? '215'}
              onChange={hue => setThemeColor(hue)}
            />
          </div>

          <div>
            <p className="text-sm font-medium mb-2">{t('masterData.theme.darkMode')}</p>
            <div className="grid grid-cols-3 gap-2">
              {modes.map(m => (
                <Button
                  key={String(m.value)}
                  type="button"
                  variant={darkMode === m.value ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => void setDarkMode(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
