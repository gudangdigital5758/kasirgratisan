import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Store as StoreIcon,
  CheckCircle2,
  Trash2,
  Loader2,
  Cloud,
  HardDrive,
  ArrowUpCircle,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  CircleOff,
  X,
  Database,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { deleteStore, CLOUD_DURATIONS } from '@/lib/cloud-api';
import {
  storeRegistry,
  getActiveStoreKey,
  setActiveStoreKey,
  deleteLocalStoreData,
  type LocalStoreEntry,
} from '@/lib/store-registry';
import { findBusinessCategory, normalizeStoreType } from '@/lib/product-fields';
import { format } from 'date-fns';
import { id as idLocale, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import type { CheckoutCartItem } from '@/lib/checkout-cart';

const LOCALES: Record<string, Locale> = { id: idLocale, en: enUS, ms };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Daftar Toko — menu gabungan Toko + Cloud & Langganan.
 * List semua toko (lokal + cloud), status per toko, upgrade/perpanjang,
 * storage lokal global, dan Cadangkan & Pulihkan (Lokal). Tambah toko
 * hanya dari tab Beranda (StoreSwitcher) — di sini tidak ada wizard.
 */
export default function DaftarToko() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('settings');
  const { can } = useAuth();
  const { isLoggedIn, profile } = useCloudAuth();
  const dateLocale = LOCALES[i18n.language] ?? idLocale;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';

  const stores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const activeKey = getActiveStoreKey();

  const [cart, setCart] = useState<CheckoutCartItem[]>([]);
  const [durationTarget, setDurationTarget] = useState<{
    storeKey: string;
    name: string;
    action: 'subscribe' | 'renew';
  } | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((e) => {
          if (typeof e.usage === 'number' && typeof e.quota === 'number') {
            setStorage({ usage: e.usage, quota: e.quota });
          }
        })
        .catch(() => {});
    }
  }, []);

  if (!can('manage_backup')) {
    return <LockedPage title={t('storeList.title')} permissionLabel={t('stores.lockedPermission')} />;
  }

  const activeName = (stores ?? []).find((s) => s.storeKey === activeKey)?.name;

  const switchStore = (key: string) => {
    if (key === activeKey) return;
    setActiveStoreKey(key);
    window.location.reload();
  };

  const cartFor = (storeKey: string) => cart.find((c) => c.storeKey === storeKey);

  const addToCart = (entry: LocalStoreEntry, action: 'subscribe' | 'renew', durationMonths: 1 | 6 | 12) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.storeKey === entry.storeKey);
      if (existing) {
        return prev.map((c) => (c.storeKey === entry.storeKey ? { ...c, action, durationMonths } : c));
      }
      return [...prev, { storeKey: entry.storeKey, name: entry.name, cloudStoreId: entry.cloudStoreId, action, durationMonths }];
    });
    setDurationTarget(null);
    toast.success(t('storeList.cartAdded'));
  };

  const removeFromCart = (storeKey: string) => setCart((prev) => prev.filter((c) => c.storeKey !== storeKey));

  const subscribeCount = cart.filter((c) => c.action === 'subscribe').length;
  const renewCount = cart.filter((c) => c.action === 'renew').length;

  const goCheckout = () => {
    if (!isLoggedIn) {
      toast.error(t('storeList.loginRequired'));
      return;
    }
    navigate('/settings/cloud/checkout', { state: { items: cart } });
  };

  const confirmEntry = (stores ?? []).find((s) => s.storeKey === confirmDeleteKey);

  const handleDelete = async () => {
    const entry = confirmEntry;
    if (!entry) return;
    setDeleting(true);
    let cloudNotDeleted = false;
    try {
      if (entry.cloudStoreId) {
        try {
          await deleteStore(entry.cloudStoreId);
        } catch (err) {
          console.warn('[stores] gagal hapus toko cloud', err);
          cloudNotDeleted = true;
        }
      }
      await deleteLocalStoreData(entry.storeKey);
      setCart((prev) => prev.filter((c) => c.storeKey !== entry.storeKey));
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

  const rp = (n: number) => `Rp ${n.toLocaleString(numberLocale)}`;

  const onlineFor = (entry: LocalStoreEntry) => {
    const ent = entry.cloudStoreId
      ? profile?.stores?.find((s) => s.id === entry.cloudStoreId)?.entitlement
      : undefined;
    return { ent, online: !!ent?.hasSync };
  };

  return (
    <div className="px-4 pt-6 pb-28 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <StoreIcon className="w-5 h-5 text-primary" />
          {t('storeList.title')}
        </h1>
      </div>

      {!isLoggedIn ? (
        <Card className="border-0 shadow-sm ring-1 ring-border/60">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold">{t('storeList.loginTitle')}</p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{t('storeList.loginPrompt')}</p>
            <Link to="/settings/cloud" className="block">
              <Button className="w-full h-9 text-xs gap-1.5">
                <Cloud className="w-3.5 h-3.5" /> {t('storeList.loginCta')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Link to="/settings/cloud" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Cloud className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{t('storeList.accountTitle')}</p>
                <p className="text-[10px] text-muted-foreground">{t('storeList.accountDesc')}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">{t('storeList.storageGlobal')}</h2>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('storeList.storageGlobalDesc')}</p>
          {storage ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{t('storeList.storageUsed')}: {formatBytes(storage.usage)}</span>
                <span>{t('storeList.storageTotal')}: {formatBytes(storage.quota)}</span>
              </div>
              <Progress
                value={storage.quota > 0 ? Math.min(100, (storage.usage / storage.quota) * 100) : 0}
                className="h-1.5"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('storeList.storageFree')}: {formatBytes(Math.max(0, storage.quota - storage.usage))}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">{t('storeList.storageUnknown')}</p>
          )}
        </CardContent>
      </Card>

      {(stores ?? []).map((store) => {
        const isActive = store.storeKey === activeKey;
        const { ent, online } = onlineFor(store);
        const cat = findBusinessCategory(store.businessCategory);
        const inCart = cartFor(store.storeKey);
        const hasCloudStore = !!store.cloudStoreId;
        return (
          <Card key={store.storeKey} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isActive ? <CheckCircle2 className="w-5 h-5" /> : <StoreIcon className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold">{store.name}</p>
                    {isActive && (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20">
                        {t('stores.active')}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[9px] h-4',
                        online ? 'bg-success/10 text-success border-success/30' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {online ? t('storeList.online') : t('storeList.offline')}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {cat
                      ? `${cat.icon} ${t(cat.labelKey)}`
                      : t(`productFields:types.${normalizeStoreType(store.storeType)}.name`)}
                  </p>
                </div>
              </div>

              {online && ent && (
                <div className="rounded-xl bg-success/10 border border-success/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
                      {ent.isLifetime
                        ? t('storeList.lifetime')
                        : t('storeList.subscribedUntil', {
                            date: ent.syncExpiry
                              ? format(new Date(ent.syncExpiry), 'd MMM yyyy', { locale: dateLocale })
                              : '—',
                          })}
                    </p>
                    {inCart && <Badge className="text-[9px] h-4">{t('storeList.selected')}</Badge>}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      {t('storeList.storage', { used: ent.usedMb.toFixed(1), limit: ent.storageLimitMb })} ·{' '}
                      {t('storeList.storageLeft', { left: ent.remainingMb })}
                    </p>
                    <Progress
                      value={ent.storageLimitMb > 0 ? Math.min(100, (ent.usedMb / ent.storageLimitMb) * 100) : 0}
                      className="h-1.5"
                    />
                  </div>
                </div>
              )}

              {!online && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CircleOff className="w-3.5 h-3.5 shrink-0" /> {t('storeList.offlineDesc')}
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {isActive ? (
                  <Button size="sm" className="h-8 text-xs" disabled>
                    {t('stores.current')}
                  </Button>
                ) : (
                  <>
                    <Button size="sm" className="h-8 text-xs" onClick={() => switchStore(store.storeKey)}>
                      {t('stores.switch')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive"
                      aria-label={t('stores.delete')}
                      onClick={() => setConfirmDeleteKey(store.storeKey)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                <div className="flex-1" />
                {inCart ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={() => removeFromCart(store.storeKey)}
                  >
                    {t('storeList.selected')} · {inCart.durationMonths} {t('storeList.monthShort')}
                    <X className="w-3 h-3" />
                  </Button>
                ) : online ? (
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() => setDurationTarget({ storeKey: store.storeKey, name: store.name, action: 'renew' })}
                  >
                    <RefreshCw className="w-3 h-3" /> {t('storeList.renew')}
                  </Button>
                ) : hasCloudStore ? (
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() => setDurationTarget({ storeKey: store.storeKey, name: store.name, action: 'subscribe' })}
                  >
                    <ArrowUpCircle className="w-3 h-3" /> {t('storeList.reactivate')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() => setDurationTarget({ storeKey: store.storeKey, name: store.name, action: 'subscribe' })}
                  >
                    <ArrowUpCircle className="w-3 h-3" /> {t('storeList.upgrade')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {(stores ?? []).length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">{t('stores.empty')}</p>
            <p className="text-[11px] text-muted-foreground/80">{t('storeList.addFromHome')}</p>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-success" />
            <h2 className="text-sm font-semibold">{t('storeList.backupTitle')}</h2>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('storeList.backupDesc')}</p>
          <p className="text-[11px] font-medium">{t('storeList.backupActiveStore', { name: activeName ?? '—' })}</p>
          <Link to="/settings/backup" className="block">
            <Button variant="outline" className="w-full h-9 text-xs gap-1.5">
              <Database className="w-3.5 h-3.5" /> {t('storeList.openBackup')}
            </Button>
          </Link>
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground leading-relaxed">{t('storeList.addFromHome')}</p>

      {cart.length > 0 && (
        <div className="fixed bottom-20 inset-x-0 z-40 px-4 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-md rounded-2xl bg-foreground text-background shadow-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {t('storeList.cartSummary', { upgrade: subscribeCount, renew: renewCount })}
              </p>
              <button type="button" onClick={() => setCart([])} className="text-[10px] underline opacity-80">
                {t('storeList.cartClear')}
              </button>
            </div>
            <Button className="w-full h-10 gap-1" onClick={goCheckout}>
              {t('storeList.cartGo')} <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={durationTarget !== null} onOpenChange={(o) => !o && setDurationTarget(null)}>
        <DialogContent className="max-w-[90vw] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('storeList.durationTitle')}</DialogTitle>
            <DialogDescription>
              {durationTarget
                ? t('storeList.durationFor', {
                    name: durationTarget.name,
                    action:
                      durationTarget.action === 'renew' ? t('storeList.renew') : t('storeList.upgrade'),
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {CLOUD_DURATIONS.map((d) => (
              <button
                key={d.months}
                type="button"
                onClick={() => {
                  const entry = (stores ?? []).find((s) => s.storeKey === durationTarget?.storeKey);
                  if (entry && durationTarget) addToCart(entry, durationTarget.action, d.months);
                }}
                className="w-full flex items-center justify-between rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm font-medium">{d.label}</span>
                <span className="text-xs text-muted-foreground">{rp(d.price)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

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
