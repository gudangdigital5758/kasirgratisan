import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  Cloud,
  Loader2,
  Trash2,
  RotateCcw,
  RefreshCw,
  HardDrive,
  Upload,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id as idLocale, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import {
  listBackups,
  downloadBackup,
  deleteBackup,
  uploadBackup,
  type CloudBackup,
} from '@/lib/cloud-api';
import { buildBackupJsonString, backupFileName, restoreFromBackupData } from '@/lib/backup';
import { useTranslation } from 'react-i18next';

const LOCALES: Record<string, Locale> = { id: idLocale, en: enUS, ms };

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CloudBackupsListSettings() {
  const { can } = useAuth();
  const { isLoggedIn, isSyncSubscribed, profile, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? idLocale;

  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<CloudBackup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudBackup | null>(null);

  const load = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const { items } = await listBackups({ page: 1, limit: 50 });
      setBackups(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackupsList.toast.loadFailed'));
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, t]);

  useEffect(() => {
    if (isLoggedIn) void load();
  }, [isLoggedIn, load]);

  if (!can('manage_backup')) {
    return (
      <LockedPage
        title={t('cloudBackupsList.locked.title')}
        permissionLabel={t('cloudBackupsList.locked.permissionLabel')}
      />
    );
  }

  const usage = profile?.storageUsage;
  const usedLabel =
    usage != null
      ? `${usage.usedMb.toFixed(2)} / ${usage.limitMb > 0 ? usage.limitMb.toFixed(0) : '—'} MB`
      : null;

  const handleUploadNow = async () => {
    setBusy('upload');
    try {
      const json = await buildBackupJsonString();
      const storeId = storeSettings?.cloudStoreId ?? undefined;
      await uploadBackup(json, backupFileName(), storeId);
      if (storeSettings?.id) {
        await db.storeSettings.update(storeSettings.id, { lastCloudBackupAt: new Date() });
      }
      await refreshProfile();
      await load();
      toast.success(t('cloudBackupsList.toast.uploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackupsList.toast.uploadFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setBusy(`restore:${restoreTarget.id}`);
    try {
      const data = await downloadBackup(restoreTarget.id);
      await restoreFromBackupData(data);
      toast.success(t('cloudBackupsList.toast.restoreSuccess'));
      setRestoreTarget(null);
      // Full reload agar live queries & session state bersih
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackupsList.toast.restoreFailed'));
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(`delete:${deleteTarget.id}`);
    try {
      await deleteBackup(deleteTarget.id);
      setBackups((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      setDeleteTarget(null);
      await refreshProfile();
      toast.success(t('cloudBackupsList.toast.deleteSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackupsList.toast.deleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings/cloud-backup">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary" />
          {t('cloudBackupsList.title')}
        </h1>
      </div>

      {!isLoggedIn ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t('cloudBackupsList.loginPrompt')}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Cloud className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{t('cloudBackupsList.quotaTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {usedLabel
                      ? t('cloudBackupsList.quotaUsed', { used: usedLabel })
                      : t('cloudBackupsList.quotaUnknown')}
                  </p>
                  {!isSyncSubscribed && (
                    <p className="text-[11px] text-warning mt-1">{t('cloudBackupsList.needSubscription')}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-9 gap-1.5"
                  disabled={!!busy || !isSyncSubscribed}
                  onClick={() => void handleUploadNow()}
                >
                  {busy === 'upload' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {t('cloudBackupsList.uploadNow')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5"
                  disabled={loading || !!busy}
                  onClick={() => void load()}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  {t('cloudBackupsList.refresh')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              {loading && backups.length === 0 ? (
                <div className="flex justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : backups.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t('cloudBackupsList.empty')}
                </p>
              ) : (
                backups.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-2 rounded-xl border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.fileName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtSize(b.fileSize)} ·{' '}
                        {format(new Date(b.createdAt), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 shrink-0"
                      disabled={!!busy}
                      onClick={() => setRestoreTarget(b)}
                    >
                      {busy === `restore:${b.id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      {t('cloudBackupsList.restore')}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive shrink-0"
                      disabled={!!busy}
                      onClick={() => setDeleteTarget(b)}
                    >
                      {busy === `delete:${b.id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
            {t('cloudBackupsList.restoreWarning')}
          </p>
        </>
      )}

      <AlertDialog open={!!restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent className="max-w-[90vw] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cloudBackupsList.restoreDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cloudBackupsList.restoreDialog.description', {
                name: restoreTarget?.fileName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy?.startsWith('restore')}>
              {t('common.cancel', { defaultValue: 'Batal' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy?.startsWith('restore')}
              onClick={(e) => {
                e.preventDefault();
                void handleRestore();
              }}
            >
              {busy?.startsWith('restore') ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t('cloudBackupsList.restoreDialog.confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[90vw] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cloudBackupsList.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cloudBackupsList.deleteDialog.description', {
                name: deleteTarget?.fileName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy?.startsWith('delete')}>
              {t('common.cancel', { defaultValue: 'Batal' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!busy?.startsWith('delete')}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {busy?.startsWith('delete') ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t('cloudBackupsList.deleteDialog.confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
