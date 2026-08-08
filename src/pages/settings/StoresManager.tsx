import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Store as StoreIcon, CheckCircle2, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { deleteStore } from '@/lib/cloud-api';
import {
  storeRegistry,
  getActiveStoreKey,
  setActiveStoreKey,
  deleteLocalStoreData,
  type LocalStoreEntry,
} from '@/lib/store-registry';
import { findBusinessCategory, normalizeStoreType } from '@/lib/product-fields';
import AddStoreWizard from '@/components/AddStoreWizard';

export default function StoresManager() {
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const { can } = useAuth();

  const stores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const activeKey = getActiveStoreKey();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canManage = can('manage_store_settings');
  if (!canManage) {
    return <LockedPage title={t('stores.title')} permissionLabel={t('stores.lockedPermission')} />;
  }

  const switchStore = (key: string) => {
    if (key === activeKey) return;
    setActiveStoreKey(key);
    // Muat ulang agar seluruh aplikasi memakai DB toko aktif (db.ts dibaca ulang).
    window.location.reload();
  };

  const confirmEntry = (stores ?? []).find((s) => s.storeKey === confirmDeleteKey);

  const handleDelete = async () => {
    const entry = confirmEntry;
    if (!entry) return;
    setDeleting(true);
    let cloudNotDeleted = false;
    try {
      // Hapus data cloud dulu (best-effort) — langganan, backup, sinkronisasi.
      if (entry.cloudStoreId) {
        try {
          await deleteStore(entry.cloudStoreId);
        } catch (err) {
          console.warn('[stores] gagal hapus toko cloud', err);
          cloudNotDeleted = true;
        }
      }
      // Hapus data lokal (registry + database IndexedDB toko).
      await deleteLocalStoreData(entry.storeKey);
      setConfirmDeleteKey(null);
      if (cloudNotDeleted) toast.warning(t('stores.toast.cloudNotDeleted'));
      else toast.success(t('stores.toast.deleted'));
    } catch (err) {
      console.error('[stores] gagal hapus toko', err);
      toast.error(t('stores.toast.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <StoreIcon className="w-5 h-5 text-primary" />
          {t('stores.title')}
        </h1>
      </div>

      <p className="text-xs text-muted-foreground">{t('stores.desc')}</p>
      <p className="text-[11px] text-muted-foreground bg-muted/50 border border-border rounded-xl p-3 flex items-start gap-2">
        <RefreshCw className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {t('stores.switchHint')}
      </p>

      <Button size="sm" className="w-full h-10 gap-1.5" onClick={() => setWizardOpen(true)}>
        <Plus className="w-4 h-4" />
        {t('stores.addButton')}
      </Button>

      <div className="space-y-2">
        {(stores ?? []).map((store: LocalStoreEntry) => {
          const isActive = store.storeKey === activeKey;
          const cat = findBusinessCategory(store.businessCategory);
          return (
            <Card key={store.storeKey} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {isActive ? <CheckCircle2 className="w-5 h-5" /> : <StoreIcon className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{store.name}</p>
                    <Badge variant="secondary" className="text-[9px] h-4">
                      {store.mode === 'cloud' ? t('stores.modeCloud') : t('stores.modeLocal')}
                    </Badge>
                    {isActive && (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20">
                        {t('stores.active')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {cat
                      ? `${cat.icon} ${t(cat.labelKey)}`
                      : t(`productFields:types.${normalizeStoreType(store.storeType)}.name`)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive ? (
                    <Button size="sm" className="h-8 text-xs" disabled>
                      {t('stores.current')}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-8 text-xs" onClick={() => switchStore(store.storeKey)}>
                      {t('stores.switch')}
                    </Button>
                  )}
                  {!isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label={t('stores.delete')}
                      onClick={() => setConfirmDeleteKey(store.storeKey)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(stores ?? []).length === 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {t('stores.empty')}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Wizard tambah toko (reusable — juga dipakai dari Beranda) */}
      <AddStoreWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      {/* Konfirmasi hapus toko */}
      <AlertDialog
        open={confirmDeleteKey !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteKey(null);
        }}
      >
        <AlertDialogContent className="max-w-[90vw] rounded-xl bg-background border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('stores.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm whitespace-pre-line">
              {confirmEntry
                ? t('stores.deleteConfirmDesc', { name: confirmEntry.name }) +
                  (confirmEntry.cloudStoreId ? `\n\n${t('stores.deleteCloudNote')}` : '')
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 mt-4">
            <AlertDialogCancel disabled={deleting} className="mt-0">
              {t('stores.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('stores.yesDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
