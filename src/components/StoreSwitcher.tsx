import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Check, Building2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  storeRegistry,
  getActiveStoreKey,
  setActiveStoreKey,
  DEFAULT_STORE_KEY,
  type LocalStoreEntry,
} from '@/lib/store-registry';
import { findBusinessCategory, normalizeStoreType } from '@/lib/product-fields';
import { useAuth } from '@/hooks/use-auth';
import AddStoreWizard from '@/components/AddStoreWizard';

/** Warna avatar per toko (dari storeKey) agar konsisten. */
const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-emerald-500/15 text-emerald-600',
  'bg-amber-500/15 text-amber-600',
  'bg-violet-500/15 text-violet-600',
  'bg-rose-500/15 text-rose-600',
  'bg-sky-500/15 text-sky-600',
];

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function storeIcon(store: LocalStoreEntry): string {
  const cat = findBusinessCategory(store.businessCategory);
  return cat?.icon ?? '🏪';
}

/**
 * Dropdown ganti toko di bagian atas Beranda. Berisi daftar toko untuk
 * berpindah + "+ Tambah Toko" (membuka AddStoreWizard).
 */
export default function StoreSwitcher() {
  const { t } = useTranslation('settings');
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const stores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const activeKey = getActiveStoreKey();
  const active = (stores ?? []).find((s) => s.storeKey === activeKey);
  const canManage = can('manage_store_settings');

  const switchStore = (key: string) => {
    if (key === activeKey) return;
    setActiveStoreKey(key);
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm text-left transition-all hover:shadow-md active:scale-[0.99]"
      >
        <span
          className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0',
            colorFor(activeKey),
          )}
        >
          {active ? storeIcon(active) : '🏪'}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            {t('stores.switcherLabel')}
          </span>
          <span className="block text-sm font-bold truncate">
            {active?.name ?? t('stores.fallbackName')}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {t('stores.switcherTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 mt-1">
            {(stores ?? []).map((store) => {
              const isActive = store.storeKey === activeKey;
              const cat = findBusinessCategory(store.businessCategory);
              return (
                <button
                  key={store.storeKey}
                  type="button"
                  onClick={() => switchStore(store.storeKey)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30 hover:bg-muted/40',
                  )}
                >
                  <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0', colorFor(store.storeKey))}>
                    {storeIcon(store)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate">{store.name}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">
                      {cat ? t(cat.labelKey) : t(`productFields:types.${normalizeStoreType(store.storeType)}.name`)}
                      {' · '}
                      {store.mode === 'cloud' ? t('stores.modeCloud') : t('stores.modeLocal')}
                    </span>
                  </span>
                  {isActive && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              );
            })}

            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setWizardOpen(true);
                }}
                className="w-full flex items-center gap-3 rounded-xl border-2 border-dashed border-primary/40 p-3 text-left text-primary hover:bg-primary/5 transition-all"
              >
                <span className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Plus className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{t('stores.addButton')}</span>
                  <span className="block text-[10px] text-muted-foreground">{t('stores.wizard.desc')}</span>
                </span>
              </button>
            )}

            {(stores ?? []).length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">
                {t('stores.empty')}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AddStoreWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  );
}
