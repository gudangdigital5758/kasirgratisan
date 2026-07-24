import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Link } from 'react-router-dom';
import { ChevronLeft, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { useTranslation } from 'react-i18next';

type Interval = 'off' | 'hourly' | 'daily' | 'weekly';
const DEFAULT_HOURS = 6;

export default function CloudAutoBackupSettings() {
  const { can } = useAuth();
  const { isLoggedIn, isSyncSubscribed } = useCloudAuth();
  const { t } = useTranslation('settings');
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  if (!can('manage_backup')) {
    return <LockedPage title={t('cloudAutoBackup.locked.title')} permissionLabel={t('cloudAutoBackup.locked.permissionLabel')} />;
  }

  const interval: Interval = (storeSettings?.cloudAutoBackupInterval as Interval) ?? 'off';
  const hours = storeSettings?.cloudAutoBackupHours ?? DEFAULT_HOURS;

  const setInterval = async (value: Interval) => {
    if (!storeSettings?.id) return;
    const patch: { cloudAutoBackupInterval: Interval; cloudAutoBackupHours?: number } = { cloudAutoBackupInterval: value };
    if (value === 'hourly' && !storeSettings.cloudAutoBackupHours) patch.cloudAutoBackupHours = DEFAULT_HOURS;
    await db.storeSettings.update(storeSettings.id, patch);
    const resolvedHours = patch.cloudAutoBackupHours ?? hours;
    toast.success(
      value === 'off'
        ? t('cloudAutoBackup.toast.off')
        : value === 'hourly'
          ? t('cloudAutoBackup.toast.hourly', { hours: resolvedHours })
          : value === 'daily'
            ? t('cloudAutoBackup.toast.daily')
            : t('cloudAutoBackup.toast.weekly')
    );
  };

  const saveHours = async (raw: string) => {
    if (!storeSettings?.id) return;
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error(t('cloudAutoBackup.hourMinError'));
      return;
    }
    await db.storeSettings.update(storeSettings.id, { cloudAutoBackupHours: parsed });
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings/cloud">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          {t('cloudAutoBackup.title')}
        </h1>
      </div>

      {!isLoggedIn || !isSyncSubscribed ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t('cloudAutoBackup.requiresSubscription')}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('cloudAutoBackup.scheduleLabel')}</p>
              <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t('cloudAutoBackup.interval.off')}</SelectItem>
                  <SelectItem value="hourly">{t('cloudAutoBackup.interval.hourly')}</SelectItem>
                  <SelectItem value="daily">{t('cloudAutoBackup.interval.daily')}</SelectItem>
                  <SelectItem value="weekly">{t('cloudAutoBackup.interval.weekly')}</SelectItem>
                </SelectContent>
              </Select>
              {interval === 'hourly' && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">{t('cloudAutoBackup.everyHours.prefix')}</span>
                  <Input
                    key={hours}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    defaultValue={hours}
                    onBlur={(e) => saveHours(e.target.value)}
                    className="h-9 w-20 text-center"
                  />
                  <span className="text-xs text-muted-foreground">{t('cloudAutoBackup.everyHours.suffix')}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t('cloudAutoBackup.scheduleNote')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
