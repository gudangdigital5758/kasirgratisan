import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Store as StoreIcon, CheckCircle2, RefreshCw, Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  storeRegistry,
  addStore,
  getActiveStoreKey,
  setActiveStoreKey,
  DEFAULT_STORE_KEY,
  dbNameForStore,
  type LocalStoreEntry,
  type StoreMode,
} from '@/lib/store-registry';
import { STORE_TYPES, DEFAULT_STORE_TYPE, normalizeStoreType, type StoreType } from '@/lib/product-fields';
import { PosDatabase } from '@/lib/db-migrations';
import { createStore } from '@/lib/cloud-api';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { toast } from 'sonner';

export default function StoresManager() {
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const { can } = useAuth();
  const { isLoggedIn, isSyncSubscribed, profile } = useCloudAuth();

  const stores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const activeKey = getActiveStoreKey();

  // Wizard tambah toko
  const [wizardOpen, setWizardOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStoreType, setNewStoreType] = useState<StoreType>(DEFAULT_STORE_TYPE);
  const [mode, setMode] = useState<StoreMode>('local');
  const [saving, setSaving] = useState(false);

  // Cloud online: butuh login + langganan sync aktif; cek batas toko per paket.
  const cloudReady = isLoggedIn && isSyncSubscribed;
  const cloudStoreCount = (stores ?? []).filter((s) => s.mode === 'cloud').length;
  const maxStores = profile?.user?.maxStores ?? profile?.syncSubscription?.plan?.maxStores ?? null;
  const isUnlimited = maxStores != null && maxStores >= 999999;
  const atLimit = maxStores != null && !isUnlimited && cloudStoreCount >= maxStores;

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

  const openWizard = () => {
    setNewName('');
    setNewStoreType(DEFAULT_STORE_TYPE);
    setMode('local');
    setWizardOpen(true);
  };

  const handleCreateStore = async () => {
    if (!newName.trim()) {
      toast.error(t('stores.wizard.nameRequired'));
      return;
    }
    if (mode === 'cloud') {
      if (!cloudReady) {
        toast.error(t('stores.wizard.cloudNotReady'));
        return;
      }
      if (atLimit) {
        toast.error(t('stores.wizard.cloudAtLimit'));
        return;
      }
    }
    setSaving(true);
    try {
      let cloudStoreId: string | null = null;
      if (mode === 'cloud') {
        // Buat toko di cloud (langganan aktif) — API sudah ada.
        const cloud = await createStore(newName.trim());
        cloudStoreId = cloud.id;
      }

      const entry = await addStore({
        name: newName.trim(),
        mode,
        cloudStoreId,
        storeType: normalizeStoreType(newStoreType),
      });

      // Pre-seed DB toko baru: storeSettings langsung (tanpa onboarding penuh),
      // agar setelah reload toko langsung siap dipakai. Data master (kategori,
      // satuan, dll.) di-seed otomatis oleh seedDefaultData saat reload.
      const newDb = new PosDatabase(dbNameForStore(entry.storeKey));
      await newDb.storeSettings.add({
        storeName: entry.name,
        address: '',
        phone: '',
        receiptFooter: 'Terima kasih atas kunjungan Anda!',
        printLogo: false,
        onboardingDone: true,
        lastBackupAt: null,
        deviceId: crypto.randomUUID(),
        storeType: entry.storeType,
        cloudStoreId,
      });

      setActiveStoreKey(entry.storeKey);
      window.location.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('stores.wizard.failed'));
      setSaving(false);
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

      <Button size="sm" className="w-full h-10 gap-1.5" onClick={openWizard}>
        <Plus className="w-4 h-4" />
        {t('stores.addButton')}
      </Button>

      <div className="space-y-2">
        {(stores ?? []).map((store: LocalStoreEntry) => {
          const isActive = store.storeKey === activeKey;
          const typeDef = STORE_TYPES.find((s) => s.value === normalizeStoreType(store.storeType));
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
                    {typeDef ? t(typeDef.labelKey) : ''}
                    {' · '}
                    {store.dbName}
                  </p>
                </div>
                {isActive ? (
                  <Button size="sm" className="h-8 text-xs" disabled>
                    {t('stores.current')}
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 text-xs" onClick={() => switchStore(store.storeKey)}>
                    {t('stores.switch')}
                  </Button>
                )}
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

      {/* Wizard tambah toko */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('stores.wizard.title')}</DialogTitle>
            <DialogDescription className="text-xs">{t('stores.wizard.desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('stores.wizard.nameLabel')} *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('stores.wizard.namePlaceholder')}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('productFields:title')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {STORE_TYPES.map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => setNewStoreType(st.value)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                      newStoreType === st.value
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border hover:border-primary/30 hover:bg-muted/50'
                    )}
                  >
                    <span className="text-xl">{st.icon}</span>
                    <span className="text-xs font-semibold leading-tight">{t(st.labelKey)}</span>
                    <span className="text-[10px] text-muted-foreground leading-snug">{t(st.descKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('stores.wizard.modeLabel')}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('local')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                    mode === 'local'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50'
                  )}
                >
                  <span className="text-lg">📱</span>
                  <span className="text-xs font-semibold">{t('stores.modeLocal')}</span>
                  <span className="text-[10px] text-muted-foreground leading-snug">{t('stores.wizard.offlineDesc')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => cloudReady && !atLimit && setMode('cloud')}
                  disabled={!cloudReady || atLimit}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                    mode === 'cloud'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50',
                    (!cloudReady || atLimit) && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <span className="text-lg">☁️</span>
                  <span className="text-xs font-semibold">{t('stores.modeCloud')}</span>
                  <span className="text-[10px] text-muted-foreground leading-snug">
                    {atLimit
                      ? t('stores.wizard.cloudAtLimit')
                      : cloudReady
                        ? t('stores.wizard.cloudDesc')
                        : t('stores.wizard.cloudNotReady')}
                  </span>
                </button>
              </div>
              {!cloudReady && (
                <p className="text-[11px] text-muted-foreground bg-muted/50 border border-border rounded-xl p-3">
                  {t('stores.wizard.cloudLoginHint')}{' '}
                  <button
                    type="button"
                    className="text-primary font-semibold underline"
                    onClick={() => { setWizardOpen(false); navigate('/settings/cloud'); }}
                  >
                    {t('stores.wizard.cloudOpen')}
                  </button>
                </p>
              )}
            </div>

            <Button className="w-full h-11 gap-1.5" onClick={handleCreateStore} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? t('stores.wizard.saving') : t('stores.wizard.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
