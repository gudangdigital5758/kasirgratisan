import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import BusinessCategoryPicker from '@/components/BusinessCategoryPicker';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  addStore,
  setActiveStoreKey,
  dbNameForStore,
  storeRegistry,
  type StoreMode,
} from '@/lib/store-registry';
import { profileForCategory, type BusinessCategory } from '@/lib/product-fields';
import { PosDatabase } from '@/lib/db-migrations';
import { createStore } from '@/lib/cloud-api';
import { syncNow } from '@/lib/sync';
import { useCloudAuth } from '@/hooks/use-cloud-auth';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Wizard tambah toko (dipakai dari Beranda dropdown & halaman Toko).
 * Memilih Kategori Usaha → profil field produk diturunkan otomatis.
 */
export default function AddStoreWizard({ open, onOpenChange }: Props) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { isLoggedIn, isSyncSubscribed, profile } = useCloudAuth();

  const [newName, setNewName] = useState('');
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const [mode, setMode] = useState<StoreMode>('local');
  const [saving, setSaving] = useState(false);

  const cloudReady = isLoggedIn && isSyncSubscribed;
  const maxStores = profile?.user?.maxStores ?? profile?.syncSubscription?.plan?.maxStores ?? null;
  const isUnlimited = maxStores != null && maxStores >= 999999;
  const stores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const cloudStoreCount = (stores ?? []).filter((s) => s.mode === 'cloud').length;
  const atLimit = maxStores != null && !isUnlimited && cloudStoreCount >= maxStores;

  const reset = () => {
    setNewName('');
    setCategory(null);
    setMode('local');
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error(t('stores.wizard.nameRequired'));
      return;
    }
    if (!category) {
      toast.error(t('stores.wizard.categoryRequired'));
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
        const cloud = await createStore(newName.trim());
        cloudStoreId = cloud.id;
      }

      const storeType = profileForCategory(category.id);
      const entry = await addStore({
        name: newName.trim(),
        mode,
        cloudStoreId,
        storeType,
        businessCategory: category.id,
      });

      // Pre-seed DB toko baru: storeSettings langsung (tanpa onboarding penuh).
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
        storeType,
        businessCategory: category.id,
        cloudStoreId,
      });

      // Sync pertama otomatis (M3) untuk toko cloud. Best-effort.
      if (mode === 'cloud') {
        try {
          await syncNow(newDb);
        } catch (err) {
          console.warn('[stores] sync awal gagal (dilanjutkan):', err);
        }
      }

      setActiveStoreKey(entry.storeKey);
      onOpenChange(false);
      window.location.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('stores.wizard.failed'));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[95vw] rounded-xl max-h-[92vh] overflow-y-auto">
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
            <Label>{t('productFields:catTitle')} *</Label>
            <BusinessCategoryPicker
              selectedId={category?.id ?? null}
              onSelect={setCategory}
            />
            {category && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span>{category.icon}</span>
                {t('productFields:catProfileHint', { profile: t(`productFields:types.${category.profile}.name`) })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('stores.wizard.modeLabel')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('local')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                  mode === 'local' ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30 hover:bg-muted/50',
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
                  mode === 'cloud' ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30 hover:bg-muted/50',
                  (!cloudReady || atLimit) && 'opacity-60 cursor-not-allowed',
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
                  onClick={() => {
                    onOpenChange(false);
                    navigate('/settings/cloud');
                  }}
                >
                  {t('stores.wizard.cloudOpen')}
                </button>
              </p>
            )}
          </div>

          <Button className="w-full h-11 gap-1.5" onClick={() => void handleCreate()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving ? t('stores.wizard.saving') : t('stores.wizard.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
