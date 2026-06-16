import { useState, useEffect, useCallback, useRef } from 'react';
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
  MonitorSmartphone,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
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
import { App } from '@capacitor/app';
import { isNativePlatform } from '@/lib/printer';
import { nativeGoogleSignIn } from '@/lib/google-auth';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { fetchPlans, checkoutPlan, verifyPayment, verifyGooglePlayPurchase, fetchStores, uploadBackup, type Plan } from '@/lib/cloud-api';
import { buildBackupJsonString, backupFileName } from '@/lib/backup';
import { useTranslation, Trans } from 'react-i18next';

const CURRENCY_SYMBOL: Record<string, string> = { id: 'Rp', en: 'Rp', ms: 'Rp' };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };
const LOCALES: Record<string, Locale> = { id, en: enUS, ms };

const fmtMb = (mb: number) => `${mb.toFixed(2)} MB`;
const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export default function CloudBackupSettings() {
  const { can } = useAuth();
  const { isLoggedIn, googleUser, profile, loadingProfile, isSubscribed, isSyncSubscribed, login, logout, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
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
  const [storeCount, setStoreCount] = useState<number | null>(null);
  const [showStoragePlans, setShowStoragePlans] = useState(false);
  const [showSyncPlans, setShowSyncPlans] = useState(false);

  const byPrice = (a: Plan, b: Plan) => a.price - b.price;
  const storagePlans = plans.filter((p) => p.category === 'STORAGE').sort(byPrice);
  const syncPlans = plans.filter((p) => p.category === 'SYNC').sort(byPrice);
  const cheapestSyncPrice = syncPlans.length ? syncPlans[0].price : null;

  const loadPlans = useCallback(async () => {
    try {
      setPlans(await fetchPlans());
    } catch {
      /* diabaikan */
    }
  }, []);

  const loadStoreCount = useCallback(async () => {
    try {
      setStoreCount((await fetchStores()).length);
    } catch {
      setStoreCount(null);
    }
  }, []);

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
    if (isLoggedIn && isSyncSubscribed) loadStoreCount();
  }, [isLoggedIn, isSyncSubscribed, loadStoreCount]);

  const checkPayment = useCallback(
    async (silent: boolean) => {
      if (!pendingTxId) return;
      if (!silent) setBusy('verify');
      try {
        const result = await verifyPayment(pendingTxId);
        if (result.transaction.status === 'COMPLETED') {
          await refreshProfile();
          setPendingTxId(null);
          setPaymentLink(null);
          setShowStoragePlans(false);
          setShowSyncPlans(false);
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
    [pendingTxId, refreshProfile, t],
  );

  useEffect(() => {
    if (!pendingTxId) return;
    const id = window.setInterval(() => checkPayment(true), 4000);
    return () => window.clearInterval(id);
  }, [pendingTxId, checkPayment]);

  const handleVerifyNativePurchase = async (transaction: any) => {
    const purchaseToken = transaction.purchaseToken || transaction.token || transaction.id;
    const productId = transaction.products?.[0]?.id;
    
    if (!purchaseToken || !productId) {
      toast.error(t('cloudBackup.toast.invalidPurchaseData', { defaultValue: 'Invalid purchase data from Google Play' }));
      return;
    }

    setBusy('verify_native');
    try {
      let packageName = 'com.kasirceria.app';
      try {
        const info = await App.getInfo();
        packageName = info.id;
      } catch (err) {
        console.warn('Failed to get app package name dynamically, using fallback', err);
      }

      const plan = plans.find(p => p.id === productId);
      const planId = plan ? plan.id : productId;

      await verifyGooglePlayPurchase(planId, productId, purchaseToken, packageName);
      
      transaction.finish();
      await refreshProfile();
      
      setShowSyncPlans(false);
      setShowStoragePlans(false);
      
      toast.success(t('cloudBackup.toast.paymentSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.verifyFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleVerifyNativePurchaseRef = useRef(handleVerifyNativePurchase);
  useEffect(() => {
    handleVerifyNativePurchaseRef.current = handleVerifyNativePurchase;
  });

  useEffect(() => {
    if (isNativePlatform() && plans.length > 0) {
      const CdvPurchase = (window as any).CdvPurchase;
      if (CdvPurchase && !(window as any).isGooglePlayBillingInitialized) {
        const { store, ProductType, Platform } = CdvPurchase;
        
        plans.forEach((plan) => {
          store.register({
            id: plan.id,
            type: ProductType.PAID_SUBSCRIPTION,
            platform: Platform.GOOGLE_PLAY,
          });
        });

        store.when()
          .approved((transaction: any) => {
            handleVerifyNativePurchaseRef.current(transaction);
          })
          .verified((receipt: any) => {
            receipt.finish();
          })
          .finished(() => {
            setBusy(null);
          });

        store.error((err: any) => {
          if (err.code !== 2 && err.code !== 'PAYMENT_CANCELLED') {
            toast.error(`Google Play Billing Error: ${err.message}`);
          }
          setBusy(null);
        });

        store.initialize([Platform.GOOGLE_PLAY]);
        (window as any).isGooglePlayBillingInitialized = true;
      }
    }
  }, [plans]);

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

  const handleSubscribe = async (planId: string) => {
    setBusy(`checkout:${planId}`);
    try {
      if (isNativePlatform()) {
        const CdvPurchase = (window as any).CdvPurchase;
        if (!CdvPurchase) {
          toast.error(t('cloudBackup.toast.billingNotAvailable', { defaultValue: 'Google Play Billing not available on this device' }));
          setBusy(null);
          return;
        }
        const { store } = CdvPurchase;
        const product = store.get(planId);
        if (!product) {
          const registered = store.products?.map((p: any) => p.id).join(', ') || 'none';
          console.warn(`Product ${planId} not found in Google Play. Registered products: ${registered}`);
          toast.error(t('cloudBackup.toast.productNotFound', { defaultValue: `Product ${planId} not found in Google Play Store` }));
          setBusy(null);
          return;
        }
        
        console.log('Google Play Billing: Product details loaded:', product);
        const offer = product.getOffer() || product.offers?.[0];
        if (offer) {
          console.log('Google Play Billing: Ordering offer:', offer.id);
          store.order(offer);
        } else {
          console.warn('Google Play Billing: No offer found for subscription. Ordering product directly.');
          store.order(planId);
        }
      } else {
        const result = await checkoutPlan(planId, { redirectURL: `${window.location.origin}/settings/cloud-backup` });
        setPaymentLink(result.paymentLink);
        setPendingTxId(result.transaction.id);
        window.open(result.paymentLink, '_blank');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudBackup.toast.checkoutFailed'));
    } finally {
      if (!isNativePlatform()) {
        setBusy(null);
      }
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

  const usage = profile?.storageUsage;

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
          {t('cloudBackup.locked.title')}
        </h1>
      </div>

      {!isLoggedIn ? (
        <div className="space-y-4">
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
                  {t('cloudBackup.hero.description', { dashboard: 'dashboard.freekasir.com' })}
                </p>
              </div>
              {cheapestSyncPrice != null && (
                <div className="inline-flex items-center gap-1 rounded-full bg-background/80 px-3 py-1 text-[11px] font-medium shadow-sm">
                  <span className="text-muted-foreground">{t('cloudBackup.hero.startFrom')}</span>
                  <span className="text-primary font-bold">{rp(cheapestSyncPrice)}</span>
                  <span className="text-muted-foreground">{t('cloudBackup.hero.perMonth')}</span>
                </div>
              )}
            </div>

            <CardContent className="p-5 space-y-4">
              <ul className="space-y-3">
                <BenefitItem
                  icon={<BarChart3 className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.realtime.title')}
                  desc={t('cloudBackup.benefits.realtime.desc')}
                />
                <BenefitItem
                  icon={<MonitorSmartphone className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.dashboard.title')}
                  desc={t('cloudBackup.benefits.dashboard.desc', { dashboard: 'dashboard.freekasir.com' })}
                />
                <BenefitItem
                  icon={<ShieldCheck className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.safe.title')}
                  desc={t('cloudBackup.benefits.safe.desc')}
                />
              </ul>

              <div className="pt-1 space-y-2">
                <p className="text-center text-xs font-medium">{t('cloudBackup.loginPrompt')}</p>
                <div className="flex justify-center">
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
              </div>
            </CardContent>
          </Card>

          <a
            href="https://dashboard.freekasir.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[11px] font-medium text-primary"
          >
            {t('cloudBackup.previewDashboard', { dashboard: 'dashboard.freekasir.com' })}
          </a>
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

          {isSyncSubscribed && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Button className="w-full h-11 gap-2 font-semibold" disabled={busy === 'sync'} onClick={handleSyncNow}>
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
                        icon={<BarChart3 className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.realtime.title')}
                        desc={t('cloudBackup.benefits.realtime.desc')}
                      />
                      <BenefitItem
                        icon={<MonitorSmartphone className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.dashboard.title')}
                        desc={t('cloudBackup.benefits.dashboard.desc', { dashboard: 'dashboard.freekasir.com' })}
                      />
                      <BenefitItem
                        icon={<ShieldCheck className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.safe.title')}
                        desc={t('cloudBackup.benefits.safe.desc')}
                      />
                    </ul>
                    <a
                      href="https://dashboard.freekasir.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[11px] font-medium text-primary pt-0.5"
                    >
                      {t('cloudBackup.previewDashboard', { dashboard: 'dashboard.freekasir.com' })}
                    </a>
                  </CardContent>
                </Card>
              )}

              <SubscriptionSection
                title={t('cloudBackup.locked.title')}
                icon={<RefreshCw className="w-4 h-4" />}
                description={t('cloudBackup.subscription.description')}
                plans={syncPlans}
                subscription={profile?.syncSubscription ?? null}
                isActive={isSyncSubscribed}
                showPlans={showSyncPlans}
                onTogglePlans={() => setShowSyncPlans((v) => !v)}
                busy={busy}
                onSubscribe={handleSubscribe}
                backupSizeBytes={null}
                storageUsage={null}
              />

              {isSyncSubscribed && storeCount === 0 && (
                <Card className="border-0 shadow-sm bg-destructive/10 ring-1 ring-destructive/30">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-destructive">{t('cloudBackup.noStore.title')}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        <Trans
                          i18nKey="cloudBackup.noStore.description"
                          ns="settings"
                          components={[<span className="font-medium" />]}
                        />
                      </p>
                      <Link to="/settings/cloud-backup/stores" className="inline-block mt-2">
                        <Button size="sm" variant="destructive" className="h-8 text-xs gap-1">
                          <Store className="w-3.5 h-3.5" /> {t('cloudBackup.noStore.createStore')}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isSyncSubscribed && storeCount !== 0 && storeCount !== null && !storeSettings?.cloudStoreId && (
                <Card className="border-0 shadow-sm border-l-4 border-l-warning">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Store className="w-4 h-4 text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{t('cloudBackup.deviceNotLinked.title')}</p>
                      <p className="text-[10px] text-muted-foreground">{t('cloudBackup.deviceNotLinked.description')}</p>
                    </div>
                    <Link to="/settings/cloud-backup/stores">
                      <Button size="sm" variant="outline" className="h-7 text-xs">{t('cloudBackup.deviceNotLinked.select')}</Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <div className="space-y-4">
            {isSyncSubscribed && (
              <>
                <ExternalMenuCard
                  href="https://dashboard.freekasir.com"
                  icon={<BarChart3 className="w-4 h-4" />}
                  title={t('cloudBackup.menu.dashboard.title')}
                  subtitle={t('cloudBackup.menu.dashboard.subtitle', { dashboard: 'dashboard.freekasir.com' })}
                />
                <MenuCard
                  to="/settings/cloud-backup/stores"
                  icon={<Store className="w-4 h-4" />}
                  title={t('cloudBackup.menu.manageStore.title')}
                  subtitle={t('cloudBackup.menu.manageStore.subtitle')}
                />
                <MenuCard
                  to="/settings/cloud-backup/auto"
                  icon={<Clock className="w-4 h-4" />}
                  title={t('cloudBackup.menu.autoSync.title')}
                  subtitle={intervalSubtitle}
                />
              </>
            )}
            <MenuCard
              to="/settings/cloud-backup/history"
              icon={<History className="w-4 h-4" />}
              title={t('cloudBackup.menu.history.title')}
              subtitle={t('cloudBackup.menu.history.subtitle')}
            />
          </div>
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
}

function SubscriptionSection({
  title, icon, description, plans, subscription, isActive,
  showPlans, onTogglePlans, busy, onSubscribe, backupSizeBytes, storageUsage,
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

  const buttonLabel = (planId: string) =>
    !isActive ? t('cloudBackup.subscription.subscribe') : planId === currentPlanId ? t('cloudBackup.subscription.renew') : t('cloudBackup.subscription.choose');

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
          return (
            <div key={plan.id} className={`flex items-center justify-between rounded-xl border p-3 ${isCurrent ? 'border-primary/40 bg-primary/5' : ''}`}>
              <div>
                <p className="text-sm font-semibold">
                  {plan.name}
                  {isCurrent && <span className="ml-1.5 text-[10px] font-medium text-primary">{t('cloudBackup.subscription.activePlan')}</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {rp(plan.price)} {t('cloudBackup.hero.perMonth')}
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

        {isActive && subscription ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span className="text-xs font-semibold">{subscription.plan.name}</span>
              </div>
              {subscription.endDate && (
                <span className="text-[10px] text-muted-foreground">
                  {t('cloudBackup.subscription.until', { date: format(new Date(subscription.endDate), 'dd MMM yyyy', { locale: dateLocale }) })}
                </span>
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
                disabled={!currentPlanId || busy === `checkout:${currentPlanId}`}
                onClick={() => currentPlanId && onSubscribe(currentPlanId)}
              >
                {busy === `checkout:${currentPlanId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudBackup.subscription.renew')}
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-9" onClick={onTogglePlans}>
                {showPlans ? t('cloudBackup.subscription.close') : t('cloudBackup.subscription.changePlan')}
              </Button>
            </div>
            {showPlans && (
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
