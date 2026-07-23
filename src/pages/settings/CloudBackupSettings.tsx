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
  MonitorSmartphone,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
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
import { fetchPlans, checkoutPlan, verifyPayment, fetchStores, uploadBackup, type Plan, type CloudStore } from '@/lib/cloud-api';
import { buildBackupJsonString, backupFileName } from '@/lib/backup';
import { BRAND } from '@/lib/brand';
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
  const [stores, setStores] = useState<CloudStore[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [hasLoadedStores, setHasLoadedStores] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);

  const storeCount = hasLoadedStores ? stores.length : null;
  const activeStoreId = storeSettings?.cloudStoreId ?? null;
  const activeStore = stores.find((s) => s.id === activeStoreId);
  const isStorePublic = activeStore?.isPublic ?? false;

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
            maxStores: BRAND.cloudMaxStores,
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
    if (isLoggedIn && isSyncSubscribed) loadStores();
  }, [isLoggedIn, isSyncSubscribed, loadStores]);

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
    [pendingTxId, refreshProfile, t],
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

  const handleSubscribe = async (planId: string) => {
    setBusy(`checkout:${planId}`);
    try {
      // Play Billing ditunda — selalu checkout web (Midtrans/Xendit/mock via API).
      const result = await checkoutPlan(planId, {
        redirectURL: `${window.location.origin}/settings/cloud-backup`,
      });
      setPaymentLink(result.paymentLink);
      setPendingTxId(result.transaction.id);
      window.open(result.paymentLink, '_blank');
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
                  icon={<MonitorSmartphone className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.dashboard.title')}
                  desc={t('cloudBackup.benefits.dashboard.desc', { dashboard: 'dashboard.profitku.my.id' })}
                />
                <BenefitItem
                  icon={<Store className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.market.title')}
                  desc={t('cloudBackup.benefits.market.desc', { market: 'market.profitku.my.id' })}
                />
                <BenefitItem
                  icon={<Sparkles className="w-4 h-4" />}
                  title={t('cloudBackup.benefits.growth.title')}
                  desc={t('cloudBackup.benefits.growth.desc')}
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
            href="https://dashboard.profitku.my.id"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[11px] font-medium text-primary"
          >
            {t('cloudBackup.previewDashboard', { dashboard: 'dashboard.profitku.my.id' })}
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
              <CardContent className="p-4 space-y-4">
                {/* Store Selector Dropdown */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground">
                      {t('cloudStore.title')}
                    </label>
                    {storeCount !== null && storeCount > 0 && (
                      <Link
                        to="/settings/cloud-backup/stores"
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
                      <Link to="/settings/cloud-backup/stores">
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
                  disabled={busy === 'sync' || !storeSettings?.cloudStoreId}
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

          {isSyncSubscribed && activeStoreId && !isStorePublic && (
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
                <Link to="/settings/cloud-backup/online-store" className="block">
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
                        icon={<MonitorSmartphone className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.dashboard.title')}
                        desc={t('cloudBackup.benefits.dashboard.desc', { dashboard: 'dashboard.profitku.my.id' })}
                      />
                      <BenefitItem
                        icon={<Store className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.market.title')}
                        desc={t('cloudBackup.benefits.market.desc', { market: 'market.profitku.my.id' })}
                      />
                      <BenefitItem
                        icon={<Sparkles className="w-4 h-4" />}
                        title={t('cloudBackup.benefits.growth.title')}
                        desc={t('cloudBackup.benefits.growth.desc')}
                      />
                    </ul>
                    <a
                      href="https://dashboard.profitku.my.id"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[11px] font-medium text-primary pt-0.5"
                    >
                      {t('cloudBackup.previewDashboard', { dashboard: 'dashboard.profitku.my.id' })}
                    </a>
                  </CardContent>
                </Card>
              )}

              <SubscriptionSection
                title={t('cloudBackup.subscription.singleTitle', { defaultValue: 'Profitku Cloud' })}
                icon={<RefreshCw className="w-4 h-4" />}
                description={t('cloudBackup.subscription.description')}
                plans={cloudPlans}
                subscription={profile?.syncSubscription ?? profile?.subscription ?? null}
                isActive={isSyncSubscribed}
                showPlans={showPlanPicker}
                onTogglePlans={() => setShowPlanPicker((v) => !v)}
                busy={busy}
                onSubscribe={handleSubscribe}
                backupSizeBytes={backupSizeBytes}
                storageUsage={profile?.storageUsage ?? null}
              />


            </>
          )}

          <div className="space-y-4">
            {isSyncSubscribed && (
              <>
                <ExternalMenuCard
                  href="https://dashboard.profitku.my.id"
                  icon={<BarChart3 className="w-4 h-4" />}
                  title={t('cloudBackup.menu.dashboard.title')}
                  subtitle={t('cloudBackup.menu.dashboard.subtitle', { dashboard: 'dashboard.profitku.my.id' })}
                />

                <MenuCard
                  to="/settings/cloud-backup/online-store"
                  icon={<Globe className="w-4 h-4" />}
                  title={t('cloudOnlineStore.title')}
                  subtitle="Atur alamat, peta koordinat, dan jam operasional tokomu"
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
              {plans.length > 1 && (
                <Button size="sm" variant="outline" className="flex-1 h-9" onClick={onTogglePlans}>
                  {showPlans ? t('cloudBackup.subscription.close') : t('cloudBackup.subscription.changePlan')}
                </Button>
              )}
            </div>
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
