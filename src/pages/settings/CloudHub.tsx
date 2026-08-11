import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Link } from 'react-router-dom';
import {
  Cloud,
  ChevronLeft,
  ChevronRight,
  LogOut,
  CheckCircle2,
  Loader2,
  CreditCard,
  Clock,
  History,
  RefreshCw,
  Store,
  BarChart3,
  ShieldCheck,
  ExternalLink,
  HardDrive,
  Sparkles,
  Globe,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { GoogleLogin } from '@react-oauth/google';
import { toast } from 'sonner';
import { format, type Locale } from 'date-fns';
import { id, enUS, ms } from 'date-fns/locale';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { isNativePlatform } from '@/lib/printer';
import { nativeGoogleSignIn } from '@/lib/google-auth';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import {
  fetchPlans,
  checkoutPlan,
  verifyPayment,
  fetchStores,
  createStore,
  claimLegacySubscription,
  bindCloudStoreDevice,
  uploadBackup,
  previewVoucher,
  type Plan,
  type CloudStore,
  type VoucherPreviewResult,
} from '@/lib/cloud-api';
import { buildBackupJsonString, backupFileName } from '@/lib/backup';
import { getDb } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { getAffiliateRef } from '@/lib/affiliate';
import { CLOUD_ROUTES } from '@/lib/cloud-routes';
import { useTranslation, Trans } from 'react-i18next';
import { cn } from '@/lib/utils';
import { storeRegistry, getActiveStoreKey, updateStore, type LocalStoreEntry } from '@/lib/store-registry';
import { syncNow, getSyncStatus } from '@/lib/sync';

const CURRENCY_SYMBOL: Record<string, string> = { id: 'Rp', en: 'Rp', ms: 'Rp' };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };
const LOCALES: Record<string, Locale> = { id, en: enUS, ms };

const fmtMb = (mb: number) => `${mb.toFixed(2)} MB`;
const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export default function CloudHub() {
  const { can } = useAuth();
  const { isLoggedIn, googleUser, profile, loadingProfile, isSyncSubscribed, login, logout, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const localStores = useLiveQuery(() => storeRegistry.stores.orderBy('createdAt').toArray());
  const activeLocalKey = getActiveStoreKey();
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? id;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const currencySymbol = CURRENCY_SYMBOL[i18n.language] ?? 'Rp';
  const rp = (n: number) => `${currencySymbol} ${n.toLocaleString(numberLocale)}`;

  const [plans, setPlans] = useState<Plan[]>([]);
  const [pendingTxId, setPendingTxId] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backupSizeBytes, setBackupSizeBytes] = useState<number | null>(null);
  const [stores, setStores] = useState<CloudStore[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [hasLoadedStores, setHasLoadedStores] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreviewResult | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [lastConflictCount, setLastConflictCount] = useState(0);
  const [dirtyCount, setDirtyCount] = useState(0);

  useEffect(() => {
    getSyncStatus().then((s) => {
      setLastSyncAt(s.lastSyncAt);
      setLastSyncError(s.lastSyncError);
      setLastConflictCount(s.lastConflictCount);
      setDirtyCount(s.dirtyCount);
    }).catch(() => {});
  }, []);

  const handleRealSync = async () => {
    setBusy('realsync');
    try {
      const res = await syncNow();
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
      const s = await getSyncStatus();
      setLastSyncAt(s.lastSyncAt);
      setLastSyncError(s.lastSyncError);
      setLastConflictCount(s.lastConflictCount);
      setDirtyCount(s.dirtyCount);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.syncFailed'));
    } finally {
      setBusy(null);
    }
  };

  const storeCount = hasLoadedStores ? stores.length : null;
  const activeStoreId = storeSettings?.cloudStoreId ?? null;
  const activeStore = stores.find((s) => s.id === activeStoreId);
  const isStorePublic = activeStore?.isPublic ?? false;
  const activeStoreHasSync = !!activeStore?.entitlement?.hasSync;

  // Single plan: Profitku Cloud (fallback ke brand id bila API belum siap)
  const cloudPlans =
    plans.length > 0
      ? plans
      : [
          {
            id: BRAND.cloudPlanId,
            name: 'Profitku Cloud',
            storageLimitMb: BRAND.cloudStorageMb,
            price: BRAND.cloudPriceIdr,
            category: 'SYNC' as const,
            maxStores: null,
          },
        ];

  const loadPlans = useCallback(async () => {
    try {
      setPlans(await fetchPlans());
    } catch {
      /* diabaikan */
    }
  }, []);

  const loadStores = useCallback(async () => {
    setLoadingStores(true);
    try {
      setStores(await fetchStores());
      setHasLoadedStores(true);
    } catch {
      setStores([]);
      setHasLoadedStores(false);
    } finally {
      setLoadingStores(false);
    }
  }, []);

  const handleRegisterLocalStore = async (localStore: LocalStoreEntry) => {
    if (!isLoggedIn) return;
    setBusy(`register:${localStore.storeKey}`);
    try {
      const existing = stores.find(
        (store) => store.name.trim().toLowerCase() === localStore.name.trim().toLowerCase(),
      );
      const cloud = existing ?? await createStore(localStore.name);
      const legacySubscription = [profile?.syncSubscription, profile?.subscription].find(
        (subscription) => subscription?.hasActiveSubscription && !subscription.storeId,
      );
      let claimResult: Awaited<ReturnType<typeof claimLegacySubscription>> | null = null;
      if (legacySubscription) {
        claimResult = await claimLegacySubscription(
          cloud.id,
          (localStores?.length ?? 0) === 1,
        );
        if (!claimResult.claimed && claimResult.reason !== 'no_legacy_subscription') {
          throw new Error('Subscription lama tidak dapat dihubungkan ke toko ini.');
        }
      }

      const targetDb = getDb(localStore.storeKey);
      const targetSettings = await targetDb.storeSettings.toCollection().first();
      const [productCount, transactionCount] = await Promise.all([
        targetDb.products.count(),
        targetDb.transactions.count(),
      ]);
      const hasLocalData = productCount > 0 || transactionCount > 0;
      const hasActiveCloud = !!cloud.entitlement?.hasSync || !!claimResult?.claimed;

      await updateStore(localStore.storeKey, {
        mode: 'cloud',
        cloudStoreId: cloud.id,
      });

      // Keep the active DB binding aligned with the registry immediately.
      if (localStore.storeKey === activeLocalKey && storeSettings?.id) {
        await db.storeSettings.update(storeSettings.id, { cloudStoreId: cloud.id });
      }

      if (targetSettings?.id) {
        await targetDb.storeSettings.update(targetSettings.id, { cloudStoreId: cloud.id });
      }

      if (hasActiveCloud && targetSettings?.deviceId) {
        await bindCloudStoreDevice(cloud.id, targetSettings.deviceId, localStore.name);

        // A new cloud store has no remote data, so the registering device is the
        // safe source for the first push. Existing local data must be reviewed
        // before it can participate in an existing store's sync stream.
        if (!existing || !hasLocalData) {
          const initialSync = await syncNow(targetDb);
          if (!initialSync.ok) console.warn('[cloud] initial sync:', initialSync.message);
        } else {
          const meta = await targetDb.syncMeta.get(1);
          await targetDb.syncMeta.put({
            ...meta,
            id: 1,
            lastPullCursor: meta?.lastPullCursor ?? null,
            lastSyncAt: meta?.lastSyncAt ?? null,
            initialSyncRequired: true,
            lastSyncError: 'Pilih sumber data sebelum initial sync antar-device.',
          });
        }
      }

      await Promise.all([loadStores(), refreshProfile()]);
      toast.success(
        existing ? t('cloudStores.linkSuccess') : t('cloudStores.registerSuccess'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudStores.registerFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleBindStore = async (storeId: string) => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { cloudStoreId: storeId || null });
    toast.success(t('cloudStore.toast.bind'));
  };

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (isLoggedIn) {
      buildBackupJsonString()
        .then((json) => setBackupSizeBytes(new Blob([json]).size))
        .catch(() => setBackupSizeBytes(null));
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) loadStores();
  }, [isLoggedIn, loadStores]);

  const checkPayment = useCallback(
    async (silent: boolean) => {
      if (!pendingTxId) return;
      if (!silent) setBusy('verify');
      try {
        const result = await verifyPayment(pendingTxId);
        if (result.transaction.status === 'COMPLETED') {
          await refreshProfile();
          await loadStores();
          setPendingTxId(null);
          setPaymentLink(null);
          setShowPlanPicker(false);
          toast.success(t('cloudBackup.toast.paymentSuccess'));
        } else if (!silent) {
          toast.info(t('cloudBackup.toast.paymentNotDetected'));
        }
      } catch (err) {
        if (!silent) toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.verifyFailed'));
      } finally {
        if (!silent) setBusy(null);
      }
    },
    [pendingTxId, refreshProfile, loadStores, t],
  );

  useEffect(() => {
    if (!pendingTxId) return;
    const id = window.setInterval(() => checkPayment(true), 4000);
    return () => window.clearInterval(id);
  }, [pendingTxId, checkPayment]);

  // Google Play Billing ditunda (BRAND.playStoreEnabled === false). Checkout lewat web payment.

  if (!can('manage_backup')) {
    return <LockedPage title={t('cloudBackup.locked.title')} permissionLabel={t('cloudBackup.locked.permissionLabel')} />;
  }

  const handleNativeLogin = async () => {
    setBusy('login');
    try {
      const idToken = await nativeGoogleSignIn();
      await login(idToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.loginFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleApplyVoucher = async () => {
    const code = voucherInput.trim();
    if (!code) {
      toast.error(t('cloudBackup.voucher.enterCode'));
      return;
    }
    const planId = cloudPlans[0]?.id || BRAND.cloudPlanId;
    setVoucherBusy(true);
    try {
      const result = await previewVoucher(code, planId);
      setVoucherPreview(result);
      if (!result.valid) {
        toast.error(result.error || t('cloudBackup.voucher.invalid'));
      } else {
        toast.success(result.message || t('cloudBackup.voucher.applied'));
      }
    } catch (err) {
      setVoucherPreview(null);
      toast.error(err instanceof Error ? err.message : t('cloudBackup.voucher.invalid'));
    } finally {
      setVoucherBusy(false);
    }
  };

  const clearVoucher = () => {
    setVoucherInput('');
    setVoucherPreview(null);
  };

  const handleSubscribe = async (planId: string) => {
    if (!activeStoreId) {
      toast.error(t('cloudBackup.toast.selectStoreFirst'));
      return;
    }
    setBusy(`checkout:${planId}`);
    try {
      const voucherCode =
        voucherPreview?.valid && voucherPreview.code
          ? voucherPreview.code
          : voucherInput.trim() || undefined;
      // Play Billing ditunda — selalu checkout web (Midtrans/Xendit/mock via API).
      // Amount 0 (voucher gratis/lifetime) di-fulfill server tanpa Snap.
      const result = await checkoutPlan(planId, {
        redirectURL: `${window.location.origin}${CLOUD_ROUTES.hub}`,
        storeId: activeStoreId,
        voucherCode,
        affiliateCode: getAffiliateRef()?.code,
        affiliateCapturedAt: getAffiliateRef()?.capturedAt,
      });
      if (result.completed || result.transaction.status === 'COMPLETED') {
        await refreshProfile();
        await loadStores();
        clearVoucher();
        setShowPlanPicker(false);
        toast.success(result.message || t('cloudBackup.toast.paymentSuccess'));
        return;
      }
      setPaymentLink(result.paymentLink);
      setPendingTxId(result.transaction.id);
      if (result.paymentLink) window.open(result.paymentLink, '_blank');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.checkoutFailed'));
    } finally {
      setBusy(null);
    }
  };

  const closePaymentModal = () => {
    setPendingTxId(null);
    setPaymentLink(null);
  };

  const handleSyncNow = async () => {
    const storeId = storeSettings?.cloudStoreId ?? undefined;
    if (!storeId) {
      toast.error(t('cloudBackup.toast.selectStoreFirst'));
      return;
    }
    setBusy('sync');
    try {
      const json = await buildBackupJsonString();
      await uploadBackup(json, backupFileName(), storeId);
      if (storeSettings?.id) await db.storeSettings.update(storeSettings.id, { lastCloudBackupAt: new Date() });
      await refreshProfile();
      toast.success(t('cloudBackup.toast.syncSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.syncFailed'));
    } finally {
      setBusy(null);
    }
  };

  const subscription = profile?.syncSubscription ?? profile?.subscription ?? null;

  const interval = storeSettings?.cloudAutoBackupInterval ?? 'off';
  const intervalSubtitle =
    interval === 'hourly'
      ? t('cloudBackup.interval.everyNHours', { hours: storeSettings?.cloudAutoBackupHours ?? 6 })
      : t(`cloudBackup.interval.${interval}`, { defaultValue: t('cloudBackup.interval.off') });

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Cloud className="w-5 h-5 text-primary" />
          {t('cloud.hub.title')}
        </h1>
      </div>

      {!isLoggedIn ? (
        <div className="space-y-4">
          {/* Login gratis (bukan checkout) — terpisah dari kartu upgrade */}
          <Card id="masuk-profitku" className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Cloud className="w-5 h-5" />
                </div>
                <p className="text-sm font-bold">{t('cloudBackup.loginCard.title')}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('cloudBackup.loginCard.description')}</p>
              <div className="flex justify-center pt-1">
                {isNativePlatform() ? (
                  <Button className="h-11 gap-2 w-full max-w-[260px]" disabled={busy === 'login'} onClick={handleNativeLogin}>
                    {busy === 'login' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                    {t('cloudBackup.continueWithGoogle')}
                  </Button>
                ) : (
                  <GoogleLogin
                    onSuccess={(cr) => {
                      if (cr.credential) login(cr.credential).catch(() => toast.error(t('cloudBackup.toast.loginFailed')));
                      else toast.error(t('cloudBackup.toast.loginFailed'));
                    }}
                    onError={() => toast.error(t('cloudBackup.toast.loginFailed'))}
                  />
                )}
              </div>
              <p className="text-center text-[10px] text-muted-foreground">{t('cloudBackup.loginHint')}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mx-auto shadow-lg shadow-primary/25">
                <RefreshCw className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-bold leading-tight">
                  <Trans i18nKey="cloudBackup.hero.title" ns="settings" components={{ br: <br /> }} />
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
                  {t('cloudBackup.hero.description')}
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full bg-background/80 px-3 py-1 text-[11px] font-medium shadow-sm">
                <span className="text-muted-foreground">{t('cloudBackup.hero.startFrom')}</span>
                <span className="text-primary font-bold">{rp(cloudPlans[0]?.price ?? BRAND.cloudPriceIdr)}</span>
                <span className="text-muted-foreground">{t('cloudBackup.hero.perMonth')}</span>
              </div>
            </div>

            <CardContent className="p-5 space-y-4">
              <ul className="space-y-3">
                <BenefitItem
                  icon={<ShieldCheck className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.safe.title')}
                  desc={t('cloudBackup.benefits.safe.desc')}
                />
                <BenefitItem
                  icon={<Clock className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.auto.title')}
                  desc={t('cloudBackup.benefits.auto.desc')}
                />
                <BenefitItem
                  icon={<HardDrive className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.quota.title')}
                  desc={t('cloudBackup.benefits.quota.desc', {
                    storageMb: BRAND.cloudStorageMb,
                    stores: t('cloudBackup.subscription.unlimitedStores'),
                  })}
                />
                <BenefitItem
                  icon={<Sparkles className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.watermark.title')}
                  desc={t('cloudBackup.benefits.watermark.desc')}
                />
              </ul>

            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-muted-foreground px-2 leading-relaxed">
            {t('cloud.hub.footer.offlineNote')}
          </p>
        </div>
      ) : (
        <>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              {googleUser?.picture ? (
                <img src={googleUser.picture} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                  {googleUser?.name?.charAt(0) ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{googleUser?.name ?? t('cloudBackup.account.fallbackName')}</p>
                <p className="text-xs text-muted-foreground truncate">{googleUser?.email}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={logout}>
                <LogOut className="w-4 h-4" /> {t('cloudBackup.account.logout')}
              </Button>
            </CardContent>
          </Card>

          {/* Toko & langganan per toko (multi-toko M3) */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                {t('cloudStores.title')}
              </p>
              {(localStores ?? []).map((s) => {
                const isActive = s.storeKey === activeLocalKey;
                const isLinked = !!s.cloudStoreId;
                const matchingCloudStore = !isLinked
                  ? stores.find(
                      (store) => store.name.trim().toLowerCase() === s.name.trim().toLowerCase(),
                    )
                  : undefined;
                const ent = isLinked
                  ? (profile?.stores ?? []).find((x) => x.id === s.cloudStoreId)?.entitlement
                  : undefined;
                const hasSync = !!ent?.hasSync;
                const expiry = ent?.syncExpiry ? new Date(ent.syncExpiry) : null;
                const expiryLabel = expiry && !Number.isNaN(expiry.getTime())
                  ? format(expiry, 'dd MMM yyyy', { locale: dateLocale })
                  : null;
                return (
                  <div key={s.storeKey} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {isLinked ? <Cloud className="w-4 h-4 text-primary" /> : <Store className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isLinked ? t('stores.modeCloud') : t('stores.modeLocal')}
                        {` · ${isLinked ? t('cloudStores.linked') : t('cloudStores.notRegistered')}`}
                        {isActive ? ` · ${t('cloudStores.active')}` : ''}
                        {isLinked && ent
                          ? ` · ${t('cloudStores.storage', { used: ent.usedMb, max: ent.storageLimitMb })}`
                          : ''}
                      </p>
                      {isLinked && ent && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {hasSync && expiryLabel
                            ? t('cloudStores.expiry', { date: expiryLabel })
                            : t('cloudStores.planInactive')}
                          {` · ${t('cloudStores.remaining', { mb: Math.max(0, ent.remainingMb) })}`}
                        </p>
                      )}
                    </div>
                    {!isLinked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] shrink-0"
                        disabled={busy === `register:${s.storeKey}`}
                        onClick={() => void handleRegisterLocalStore(s)}
                      >
                        {busy === `register:${s.storeKey}`
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : matchingCloudStore
                            ? t('cloudStores.connectExisting')
                            : t('cloudStores.register')}
                      </Button>
                    ) : (
                      <span
                        className={cn(
                          'text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0',
                          hasSync ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {hasSync ? t('cloudStores.planActive') : t('cloudStores.planInactive')}
                      </span>
                    )}
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground leading-snug pt-1">
                {t('cloudStores.note', { price: rp(BRAND.cloudPriceIdr) })}
              </p>
            </CardContent>
          </Card>

          {isLoggedIn && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                {/* Store Selector Dropdown */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground">
                      {t('cloudStore.title')}
                    </label>
                    {storeCount !== null && storeCount > 0 && (
                      <Link
                        to={CLOUD_ROUTES.stores}
                        className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                      >
                        {t('cloudBackup.menu.manageStore.title')} <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  {loadingStores ? (
                    <div className="h-10 flex items-center justify-center border rounded-xl bg-muted/20">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : storeCount === 0 ? (
                    <div className="flex flex-col gap-2 p-3 border border-dashed rounded-xl text-center bg-muted/5">
                      <p className="text-xs text-muted-foreground">{t('cloudBackup.noStore.title')}</p>
                      <Link to={CLOUD_ROUTES.stores}>
                        <Button size="sm" variant="outline" className="h-8 text-xs w-full gap-1">
                          <Store className="w-3.5 h-3.5" /> {t('cloudBackup.noStore.createStore')}
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <Select
                      value={storeSettings?.cloudStoreId ?? ''}
                      onValueChange={handleBindStore}
                    >
                      <SelectTrigger className="w-full h-10 rounded-xl bg-background border border-input shadow-none">
                        <SelectValue placeholder={t('cloudBackup.deviceNotLinked.title')} />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <Button
                  className="w-full h-11 gap-2 font-semibold"
                  disabled={busy === 'sync' || !activeStoreId || !activeStoreHasSync}
                  onClick={handleSyncNow}
                >
                  {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {t('cloudBackup.syncNow')}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  {storeSettings?.lastCloudBackupAt
                    ? t('cloudBackup.lastSync', { time: new Date(storeSettings.lastCloudBackupAt).toLocaleString(numberLocale) })
                    : t('cloudBackup.neverSynced')}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Sinkronisasi lintas perangkat (Phase A M2) */}
          {activeStoreId && activeStoreHasSync && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('cloudBackup.realSync.title')}
                </p>
                <Button className="w-full h-11 gap-2 font-semibold" disabled={busy === 'realsync'} onClick={handleRealSync}>
                  {busy === 'realsync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {t('cloudBackup.realSync.button')}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  {lastSyncAt
                    ? t('cloudBackup.realSync.lastSync', { time: lastSyncAt.toLocaleString(numberLocale) })
                    : t('cloudBackup.realSync.never')}
                </p>
                {dirtyCount > 0 && (
                  <p className="text-[10px] text-warning text-center font-medium">
                    {t('cloudBackup.realSync.dirty', { count: dirtyCount })}
                  </p>
                )}
                {lastConflictCount > 0 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    {t('cloudBackup.realSync.conflicts', { count: lastConflictCount })}
                  </p>
                )}
                {lastSyncError && (
                  <p className="text-[10px] text-destructive text-center font-medium">
                    {t('cloudBackup.realSync.error', { message: lastSyncError })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {activeStoreHasSync && activeStoreId && !isStorePublic && (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-primary/10 to-transparent ring-1 ring-primary/20">
              <CardContent className="p-4 space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      {t('cloudBackup.promo.title')}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                      {t('cloudBackup.promo.description')}
                    </p>
                    <ul className="mt-2.5 space-y-1.5">
                      <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                        <span>{t('cloudBackup.promo.benefit1')}</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                        <span>{t('cloudBackup.promo.benefit2')}</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                        <span>{t('cloudBackup.promo.benefit3')}</span>
                      </li>
                    </ul>
                  </div>
                </div>
                <Link to={CLOUD_ROUTES.onlineStore} className="block">
                  <Button size="sm" className="w-full h-9 text-xs gap-1.5 font-semibold">
                    <Store className="w-3.5 h-3.5" />
                    {t('cloudBackup.promo.button')}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {loadingProfile && !profile ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {!isSyncSubscribed && (
                <Card className="border-0 shadow-sm bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-bold flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 text-primary" />
                      {t('cloudBackup.manageFromAnywhere')}
                    </p>
                    <ul className="space-y-2.5">
                      <BenefitItem
                        icon={<ShieldCheck className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.safe.title')}
                        desc={t('cloudBackup.benefits.safe.desc')}
                      />
                      <BenefitItem
                        icon={<Clock className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.auto.title')}
                        desc={t('cloudBackup.benefits.auto.desc')}
                      />
                      <BenefitItem
                        icon={<HardDrive className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.quota.title')}
                        desc={t('cloudBackup.benefits.quota.desc', {
                          storageMb: BRAND.cloudStorageMb,
                          stores: t('cloudBackup.subscription.unlimitedStores'),
                        })}
                      />
                      <BenefitItem
                        icon={<Sparkles className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.watermark.title')}
                        desc={t('cloudBackup.benefits.watermark.desc')}
                      />
                    </ul>
                  </CardContent>
                </Card>
              )}

              <SubscriptionSection
                title={t('cloudBackup.subscription.singleTitle', { defaultValue: 'Profitku Cloud' })}
                icon={<RefreshCw className="w-4 h-4" />}
                description={t('cloudBackup.subscription.description')}
                plans={cloudPlans}
                subscription={subscription}
                isActive={activeStoreHasSync}
                showPlans={showPlanPicker}
                onTogglePlans={() => setShowPlanPicker((v) => !v)}
                busy={busy}
                onSubscribe={handleSubscribe}
                backupSizeBytes={backupSizeBytes}
                storageUsage={
                  activeStore?.entitlement
                    ? {
                        usedMb: activeStore.entitlement.usedMb,
                        limitMb: activeStore.entitlement.storageLimitMb,
                        remainingMb: activeStore.entitlement.remainingMb,
                      }
                    : profile?.storageUsage ?? null
                }
                voucherPreview={voucherPreview}
                voucherInput={voucherInput}
                voucherBusy={voucherBusy}
                onVoucherInputChange={(v) => {
                  setVoucherInput(v.toUpperCase());
                  if (voucherPreview) setVoucherPreview(null);
                }}
                onApplyVoucher={() => void handleApplyVoucher()}
                onClearVoucher={clearVoucher}
                affiliateRef={getAffiliateRef()}
              />


            </>
          )}

          <div className="space-y-4">
            {activeStoreHasSync && (
              <>
                <MenuCard
                  to={CLOUD_ROUTES.onlineStore}
                  icon={<Globe className="w-4 h-4" />}
                  title={t('cloudOnlineStore.title')}
                  subtitle={t('cloud.hub.menu.onlineStore.subtitle')}
                />

                <MenuCard
                  to={CLOUD_ROUTES.auto}
                  icon={<Clock className="w-4 h-4" />}
                  title={t('cloudBackup.menu.autoSync.title')}
                  subtitle={intervalSubtitle}
                />

                <MenuCard
                  to={CLOUD_ROUTES.files}
                  icon={<Cloud className="w-4 h-4" />}
                  title={t('cloudBackup.menu.files.title')}
                  subtitle={t('cloudBackup.menu.files.subtitle')}
                />
              </>
            )}
            {isLoggedIn && (
              <MenuCard
                to={CLOUD_ROUTES.history}
                icon={<History className="w-4 h-4" />}
                title={t('cloudBackup.menu.history.title')}
                subtitle={t('cloudBackup.menu.history.subtitle')}
              />
            )}
          </div>

          <p className="text-center text-[11px] text-muted-foreground px-2 leading-relaxed pb-2">
            {t('cloud.hub.footer.offlineNote')}
          </p>
        </>
      )}

      <Dialog open={!!pendingTxId} onOpenChange={(o) => !o && closePaymentModal()}>
        <DialogContent className="max-w-[88vw] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">{t('cloudBackup.paymentDialog.title')}</DialogTitle>
            <DialogDescription className="text-center">
              {t('cloudBackup.paymentDialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-2">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-7 h-7 text-primary" />
              </div>
              <Loader2 className="w-16 h-16 absolute inset-0 text-primary animate-spin" style={{ animationDuration: '1.5s' }} />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {t('cloudBackup.paymentDialog.checking')}
            </p>
          </div>

          <div className="space-y-2">
            <Button className="w-full h-10 gap-2" disabled={busy === 'verify'} onClick={() => checkPayment(false)}>
              {busy === 'verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t('cloudBackup.paymentDialog.iHavePaid')}
            </Button>
            {paymentLink && (
              <Button
                variant="outline"
                className="w-full h-10 gap-2"
                onClick={() => window.open(paymentLink, '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
                {t('cloudBackup.paymentDialog.openPaymentPage')}
              </Button>
            )}
            <Button variant="ghost" className="w-full h-9 text-muted-foreground" onClick={closePaymentModal}>
              {t('cloudBackup.paymentDialog.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Reusable subscription section for STORAGE / SYNC ---

interface SubscriptionSectionProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  plans: Plan[];
  subscription: import('@/lib/cloud-api').Subscription | null;
  isActive: boolean;
  showPlans: boolean;
  onTogglePlans: () => void;
  busy: string | null;
  onSubscribe: (planId: string) => void;
  backupSizeBytes: number | null;
  storageUsage: import('@/lib/cloud-api').StorageUsage | null;
  voucherPreview?: VoucherPreviewResult | null;
  voucherInput: string;
  voucherBusy: boolean;
  onVoucherInputChange: (value: string) => void;
  onApplyVoucher: () => void;
  onClearVoucher: () => void;
  affiliateRef?: { code: string; name?: string } | null;
}

function SubscriptionSection({
  title, icon, description, plans, subscription, isActive,
  showPlans, onTogglePlans, busy, onSubscribe, backupSizeBytes, storageUsage,
  voucherPreview,
  voucherInput,
  voucherBusy,
  onVoucherInputChange,
  onApplyVoucher,
  onClearVoucher,
  affiliateRef,
}: SubscriptionSectionProps) {
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? id;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const currencySymbol = CURRENCY_SYMBOL[i18n.language] ?? 'Rp';
  const rp = (n: number) => `${currencySymbol} ${n.toLocaleString(numberLocale)}`;

  const currentPlanId = subscription?.planId;
  const usage = storageUsage;
  const usagePct = usage && usage.limitMb > 0 ? Math.min(100, (usage.usedMb / usage.limitMb) * 100) : 0;
  const isStorage = !!usage;
  const isLifetime = !!subscription?.isLifetime;

  const validVoucher = voucherPreview?.valid ? voucherPreview : null;

  const displayPrice = (plan: Plan) => {
    if (validVoucher && typeof validVoucher.amountAfter === 'number') {
      return validVoucher.amountAfter;
    }
    return plan.price;
  };

  const buttonLabel = (planId: string) => {
    if (validVoucher && (validVoucher.isLifetime || validVoucher.amountAfter === 0)) {
      return t('cloudBackup.voucher.activateFree');
    }
    if (!isActive) return t('cloudBackup.subscription.subscribe');
    if (planId === currentPlanId) return t('cloudBackup.subscription.renew');
    return t('cloudBackup.subscription.choose');
  };

  const voucherBlock = (
    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-foreground">{t('cloudBackup.voucher.title')}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={voucherInput}
          onChange={(e) => onVoucherInputChange(e.target.value)}
          placeholder={t('cloudBackup.voucher.placeholder')}
          className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono tracking-wide uppercase"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="outline"
          className="h-10 shrink-0"
          disabled={voucherBusy || !voucherInput.trim()}
          onClick={onApplyVoucher}
        >
          {voucherBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudBackup.voucher.apply')}
        </Button>
      </div>
      {validVoucher && (
        <div className="rounded-lg bg-success/10 text-success text-xs px-3 py-2 flex items-start justify-between gap-2">
          <span className="leading-snug">{validVoucher.message}</span>
          <button
            type="button"
            className="text-[10px] underline shrink-0 opacity-80"
            onClick={onClearVoucher}
          >
            {t('cloudBackup.voucher.clear')}
          </button>
        </div>
      )}
      {voucherPreview && !voucherPreview.valid && voucherPreview.error && (
        <p className="text-[11px] text-destructive">{voucherPreview.error}</p>
      )}
    </div>
  );

  const plansList = (
    <div className="space-y-2">
      {plans.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">{t('cloudBackup.subscription.loadingPlans')}</p>
      ) : (
        plans.map((plan) => {
          const est = isStorage && backupSizeBytes
            ? Math.max(1, Math.floor((plan.storageLimitMb * 1024 * 1024) / backupSizeBytes))
            : null;
          const isCurrent = isActive && plan.id === currentPlanId;
          const storeLimit = plan.maxStores;
          const price = displayPrice(plan);
          const discounted =
            !!validVoucher &&
            typeof validVoucher.amountBefore === 'number' &&
            price < validVoucher.amountBefore;
          return (
            <div key={plan.id} className={`flex items-center justify-between rounded-xl border p-3 ${isCurrent ? 'border-primary/40 bg-primary/5' : ''}`}>
              <div>
                <p className="text-sm font-semibold">
                  {plan.name}
                  {isCurrent && <span className="ml-1.5 text-[10px] font-medium text-primary">{t('cloudBackup.subscription.activePlan')}</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {discounted ? (
                    <>
                      <span className="line-through opacity-60 mr-1">{rp(validVoucher!.amountBefore!)}</span>
                      <span className="text-success font-semibold">{rp(price)}</span>
                    </>
                  ) : (
                    <>{rp(price)}</>
                  )}{' '}
                  {t('cloudBackup.hero.perMonth')}
                  {isStorage && <> · {plan.storageLimitMb} MB</>}
                  {!isStorage && storeLimit != null && (
                    <> · {storeLimit >= 999999 ? t('cloudBackup.subscription.unlimitedStores') : t('cloudBackup.subscription.store', { count: storeLimit })}</>
                  )}
                </p>
                {est != null && (
                  <p className="text-[11px] text-success font-medium mt-0.5">{t('cloudBackup.subscription.estimatedBackups', { count: est.toLocaleString(numberLocale) })}</p>
                )}
              </div>
              <Button
                size="sm"
                variant={isActive && !isCurrent ? 'outline' : 'default'}
                className="h-8"
                disabled={busy === `checkout:${plan.id}`}
                onClick={() => onSubscribe(plan.id)}
              >
                {busy === `checkout:${plan.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : buttonLabel(plan.id)}
              </Button>
            </div>
          );
        })
      )}
      {isStorage && backupSizeBytes != null && (
        <p className="text-[10px] text-muted-foreground">
          {t('cloudBackup.subscription.estimateNote', { size: fmtSize(backupSizeBytes) })}
        </p>
      )}
    </div>
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <p className="text-sm font-semibold">{title}</p>
        </div>

        {affiliateRef && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground leading-snug">
            {t('cloudBackup.affiliate.referredBy', {
              name: affiliateRef.name || affiliateRef.code,
            })}
          </div>
        )}

        {isActive && subscription ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span className="text-xs font-semibold">{subscription.plan?.name ?? 'Profitku Cloud'}</span>
              </div>
              {isLifetime ? (
                <span className="text-[10px] text-success font-medium">
                  {t('cloud.hub.status.lifetime')}
                </span>
              ) : (
                subscription.endDate && (
                  <span className="text-[10px] text-muted-foreground">
                    {t('cloudBackup.subscription.until', { date: format(new Date(subscription.endDate), 'dd MMM yyyy', { locale: dateLocale }) })}
                  </span>
                )
              )}
            </div>
            {usage && (
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>{fmtMb(usage.usedMb)} {t('cloudBackup.subscription.used')}</span>
                  <span>{t('cloudBackup.subscription.from')} {fmtMb(usage.limitMb)}</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${usagePct}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-9"
                disabled={isLifetime || !currentPlanId || busy === `checkout:${currentPlanId}`}
                onClick={() => currentPlanId && onSubscribe(currentPlanId)}
              >
                {busy === `checkout:${currentPlanId}`
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : validVoucher && (validVoucher.isLifetime || validVoucher.amountAfter === 0)
                    ? t('cloudBackup.voucher.activateFree')
                    : t('cloudBackup.subscription.renew')}
              </Button>
              {plans.length > 1 && (
                <Button size="sm" variant="outline" className="flex-1 h-9" onClick={onTogglePlans}>
                  {showPlans ? t('cloudBackup.subscription.close') : t('cloudBackup.subscription.changePlan')}
                </Button>
              )}
            </div>
            {voucherBlock}
            {showPlans && plans.length > 1 && (
              <div className="pt-1 space-y-3 border-t">
                <p className="text-xs text-muted-foreground pt-2">
                  {t('cloudBackup.subscription.extendOrChange')}
                </p>
                {plansList}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{description}</p>
            {plansList}
            {voucherBlock}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Benefit item (marketing highlight) ---

function BenefitItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
      </div>
    </li>
  );
}

// --- Menu card ---

function MenuCard({ to, icon, title, subtitle }: { to: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link to={to} className="block">
      <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function ExternalMenuCard({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block">
      <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </a>
  );
}
