import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Download, Upload, ChevronLeft, HardDrive, Trash2, RotateCcw, Camera } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { exportBackupData } from '@/components/BackupReminder';
import { restoreFromBackupData } from '@/lib/backup';
import { captureLocalBackup, deleteLocalBackup, exportLocalSnapshotToDevice, listLocalBackups, restoreFromLocalBackup } from '@/lib/local-backup';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { storeRegistry, getActiveStoreKey } from '@/lib/store-registry';

const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

type LocalInterval = 'off' | 'hourly' | 'daily';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupRestoreSettings() {
  const { t, i18n } = useTranslation('settings');
  const { can } = useAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const localBackups = useLiveQuery(() => listLocalBackups(), []);
  const activeStoreEntry = useLiveQuery(() => storeRegistry.stores.where('storeKey').equals(getActiveStoreKey()).first());
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';

  if (!can('manage_backup')) {
    return <LockedPage title={t('backupRestore.locked.title')} permissionLabel={t('backupRestore.locked.permissionLabel')} />;
  }

  const localInterval: LocalInterval = (storeSettings?.localAutoBackup as LocalInterval) ?? 'hourly';

  const setLocalInterval = async (value: LocalInterval) => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { localAutoBackup: value });
    toast.success(
      value === 'off'
        ? t('localAutoBackup.toast.off')
        : value === 'hourly'
          ? t('localAutoBackup.toast.hourly')
          : t('localAutoBackup.toast.daily'),
    );
  };

  const handleSnapshotNow = async () => {
    try {
      await captureLocalBackup();
      await exportLocalSnapshotToDevice(); // M2: file fisik di Android (best-effort)
      if (storeSettings?.id) {
        await db.storeSettings.update(storeSettings.id, { lastLocalBackupAt: new Date() });
      }
      toast.success(t('localAutoBackup.toast.saved'));
    } catch {
      toast.error(t('localAutoBackup.toast.saveFailed'));
    }
  };

  const handleRestoreSnapshot = async (id: number) => {
    if (!window.confirm(t('localAutoBackup.restoreConfirm'))) return;
    try {
      await restoreFromLocalBackup(id);
      toast.success(t('localAutoBackup.toast.restored'));
      window.setTimeout(() => window.location.reload(), 800);
    } catch {
      toast.error(t('localAutoBackup.toast.restoreFailed'));
    }
  };

  const handleDeleteSnapshot = async (id: number) => {
    if (!window.confirm(t('localAutoBackup.deleteConfirm'))) return;
    await deleteLocalBackup(id);
    toast.success(t('localAutoBackup.toast.deleted'));
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!text.trim()) { toast.error(t('backupRestore.emptyFile')); return; }
        const data = JSON.parse(text);
        await restoreFromBackupData(data);
        toast.success(t('backupRestore.restoreSuccess'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('backupRestore.readError'));
      }
    };
    input.click();
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          {t('backupRestore.title')}
        </h1>
      </div>

      {activeStoreEntry && (
        <p className="text-[11px] text-muted-foreground text-center">
          {t('backupRestore.activeStore', { name: activeStoreEntry.name })}
        </p>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={exportBackupData}>
            <Download className="w-4 h-4" /> {t('backupRestore.exportButton')}
          </Button>
          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={handleImport}>
            <Upload className="w-4 h-4" /> {t('backupRestore.importButton')}
          </Button>
          {storeSettings?.lastBackupAt && (
            <p className="text-[10px] text-muted-foreground text-center">{t('backupRestore.lastBackup', { time: new Date(storeSettings.lastBackupAt).toLocaleString(numberLocale) })}</p>
          )}
        </CardContent>
      </Card>

      {/* Backup otomatis lokal (OFFLINE-BACKUP M0) */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">{t('localAutoBackup.title')}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t('localAutoBackup.description')}</p>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('localAutoBackup.intervalLabel')}</p>
            <Select value={localInterval} onValueChange={(v) => setLocalInterval(v as LocalInterval)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('localAutoBackup.interval.off')}</SelectItem>
                <SelectItem value="hourly">{t('localAutoBackup.interval.hourly')}</SelectItem>
                <SelectItem value="daily">{t('localAutoBackup.interval.daily')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={handleSnapshotNow}>
            <Camera className="w-4 h-4" /> {t('localAutoBackup.backupNow')}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            {t('localAutoBackup.lastBackup', {
              time: storeSettings?.lastLocalBackupAt
                ? new Date(storeSettings.lastLocalBackupAt).toLocaleString(numberLocale)
                : t('localAutoBackup.never'),
            })}
          </p>
          <p className="text-[10px] text-muted-foreground">{t('localAutoBackup.note')}</p>
        </CardContent>
      </Card>

      {/* Daftar snapshot lokal */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">{t('localAutoBackup.snapshotsTitle')}</h2>
          {(!localBackups || localBackups.length === 0) && (
            <p className="text-xs text-muted-foreground">{t('localAutoBackup.empty')}</p>
          )}
          {localBackups?.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{new Date(b.createdAt).toLocaleString(numberLocale)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBytes(b.sizeBytes)}{b.rowCount !== undefined ? ` · ${b.rowCount} baris` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={t('localAutoBackup.restore')} onClick={() => b.id !== undefined && handleRestoreSnapshot(b.id)}>
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title={t('localAutoBackup.delete')} onClick={() => b.id !== undefined && handleDeleteSnapshot(b.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
