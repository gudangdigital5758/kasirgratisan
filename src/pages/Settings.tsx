import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoreCustomField } from '@/lib/db';
import {
  STORE_TYPES,
  DEFAULT_STORE_TYPE,
  normalizeStoreType,
  resolveStoreType,
  BUSINESS_CATEGORIES,
  type StoreType,
  type ProductFieldType,
  type BusinessCategory,
} from '@/lib/product-fields';
import BusinessCategoryPicker from '@/components/BusinessCategoryPicker';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Settings, Store, CreditCard, Tag, Download, Edit2, Info, Truck, ArrowDownToLine, ArrowUpFromLine, ChevronRight, Receipt, Palette, HardDrive, Package, Camera, X, Ruler, Users as UsersIcon, UserCog, ShieldCheck, LogOut, Smartphone, CheckCircle2, Globe, Share2, Wallet, Sparkles, LineChart, Cloud, HandCoins, ClipboardCheck, LayoutGrid, Send, AlertTriangle, Bell } from 'lucide-react';
import {
  isPushSupported,
  getPermissionState,
  requestPushPermission,
  checkPushPermissionNative,
} from '@/lib/onesignal';

import WhatsNewModal from '@/components/WhatsNewModal';
import SettingsLinkCard from '@/components/SettingsLinkCard';
import { FEATURES, getUnseenFeatures } from '@/lib/whats-new';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { compressImage } from '@/lib/image-utils';
import { useAuth } from '@/hooks/use-auth';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { createUser, isValidPin, isValidUsername, saveSession } from '@/lib/auth';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics';
import { usePWAInstall } from '@/hooks/use-pwa-install';
import { isNativePlatform, getDefaultBluetoothPrinter, setDefaultBluetoothPrinter, listPairedBluetoothDevices, type BluetoothPrinter } from '@/lib/printer';
import { Printer } from 'lucide-react';
import { APP_VERSION } from '@/lib/app-version';
import { useTranslation, Trans } from 'react-i18next';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { syncStoreEntryFromSettings } from '@/lib/store-registry';
import { cn } from '@/lib/utils';
import { fetchAppSetting, type AppSetting } from '@/lib/cloud-api';
import { BRAND } from '@/lib/brand';

export default function Pengaturan() {
  const { t } = useTranslation('settings');
  const isNative = isNativePlatform();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const categories = useLiveQuery(() => db.categories.where('isDeleted').equals(0).toArray());
  const usersCount = useLiveQuery(() => db.users.count());
  const units = useLiveQuery(() => db.units.where('isDeleted').equals(0).toArray());
  const expenseCategories = useLiveQuery(() =>
    db.expenseCategories.where('isDeleted').equals(0).toArray(),
  );
  const activeDebts = useLiveQuery(() => db.debts.where('status').anyOf('unpaid', 'partial').toArray());

  const { multiUserEnabled, currentUser, isOwner, can, logout } = useAuth();
  const { isLoggedIn: cloudLoggedIn, isSyncSubscribed: cloudSubscribed, profile } = useCloudAuth();

  // PWA install
  const { canInstall, isInstalled, isIOS, install } = usePWAInstall();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  // Multi-user activation
  const [activateOpen, setActivateOpen] = useState(false);
  const [actName, setActName] = useState('');
  const [actUsername, setActUsername] = useState('');
  const [actPin, setActPin] = useState('');
  const [actPinConfirm, setActPinConfirm] = useState('');
  const [activating, setActivating] = useState(false);

  // Disable multi-user confirmation
  const [disableOpen, setDisableOpen] = useState(false);

  // Logout confirmation
  const [logoutOpen, setLogoutOpen] = useState(false);

  // Analytics opt-out (default: tracking on)
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled());

  // Action buttons config from API
  const [actionButtonsConfig, setActionButtonsConfig] = useState<AppSetting | null>(null);
  useEffect(() => {
    fetchAppSetting('action_buttons')
      .then((setting) => setActionButtonsConfig(setting))
      .catch((err) => console.warn('[action_buttons]', err));
  }, []);

  // Push notification status (OneSignal)
  const [pushState, setPushState] = useState<'unsupported' | 'off' | 'default' | 'granted' | 'denied'>('unsupported');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!isPushSupported()) {
        if (!cancelled) setPushState('unsupported');
        return;
      }
      if (isNative) {
        const ok = await checkPushPermissionNative();
        if (!cancelled) setPushState(ok ? 'granted' : 'default');
        return;
      }
      const p = getPermissionState();
      if (!cancelled) {
        if (p === 'unsupported') setPushState('unsupported');
        else setPushState(p);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [isNative, cloudLoggedIn]);

  // Cashier layout mode settings (default: 'grid')
  const [cashierLayoutMode, setCashierLayoutModeState] = useState<'grid' | 'rows'>(() => {
    try {
      return (localStorage.getItem('kg_cashier_layout_mode') as 'grid' | 'rows') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleCashierLayoutModeChange = (val: 'grid' | 'rows') => {
    setCashierLayoutModeState(val);
    try {
      localStorage.setItem('kg_cashier_layout_mode', val);
      toast.success(t('toast.saveSuccess'));
    } catch {
      toast.error(t('common:error') || 'Gagal');
    }
  };

  // Native Bluetooth printer settings
  const [defaultPrinter, setDefaultPrinter] = useState<BluetoothPrinter | null>(() => getDefaultBluetoothPrinter());
  const [pairedPrinters, setPairedPrinters] = useState<BluetoothPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);

  const refreshPairedPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const devices = await listPairedBluetoothDevices();
      setPairedPrinters(devices);
      if (devices.length === 0) {
        toast.error(t('toast.noPairedDevices'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.loadPrintersFailed'));
    } finally {
      setLoadingPrinters(false);
    }
  };

  const selectDefaultPrinter = (printer: BluetoothPrinter) => {
    setDefaultBluetoothPrinter(printer);
    setDefaultPrinter(printer);
    toast.success(t('toast.printerDefaultSet', { name: printer.name }));
  };

  const clearDefaultPrinter = () => {
    setDefaultBluetoothPrinter(null);
    setDefaultPrinter(null);
    toast.success(t('toast.printerDefaultCleared'));
  };

  const handleToggleAnalytics = (enabled: boolean) => {
    setAnalyticsOn(enabled);
    setAnalyticsEnabled(enabled);
    toast.success(enabled ? t('privacyAnalytics.enabled') : t('privacyAnalytics.disabled'));
  };

  const handleToggleDebt = async (enabled: boolean) => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { allowDebt: enabled });
    toast.success(enabled ? t('toast.debtEnabled') : t('toast.debtDisabled'));
  };

  // Store edit
  const [storeDialog, setStoreDialog] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeAddr, setStoreAddr] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeLogo, setStoreLogo] = useState<string | undefined>(undefined);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Storage info (CR-9)
  const [storageUsage, setStorageUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then(est => {
        setStorageUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      });
    }
  }, []);

  // What's New
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const unseenFeatures = useMemo(
    () => getUnseenFeatures(storeSettings?.seenWhatsNewIds),
    [storeSettings?.seenWhatsNewIds],
  );

  const openStoreEdit = () => {
    setStoreName(storeSettings?.storeName ?? '');
    setStoreAddr(storeSettings?.address ?? '');
    setStorePhone(storeSettings?.phone ?? '');
    setStoreLogo(storeSettings?.logo);
    setStoreDialog(true);
  };

  const saveStore = async () => {
    if (storeSettings?.id) {
      await db.storeSettings.update(storeSettings.id, { storeName: storeName.trim(), address: storeAddr.trim(), phone: storePhone.trim(), logo: storeLogo || undefined });
      await syncStoreEntryFromSettings({ storeName: storeName.trim() });
      toast.success(t('storeDialog.saveSuccess'));
      setStoreDialog(false);
    }
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('toast.invalidImage'));
      return;
    }
    try {
      const compressed = await compressImage(file);
      setStoreLogo(compressed);
    } catch {
      toast.error(t('toast.processImageFailed'));
    }
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  // === Jenis toko & kolom khusus (PRODUCT-TYPES) ===
  const [storeTypeDialog, setStoreTypeDialog] = useState(false);
  const [storeTypeSel, setStoreTypeSel] = useState<StoreType>(DEFAULT_STORE_TYPE);
  const [storeCategory, setStoreCategory] = useState<BusinessCategory | null>(null);
  const [customFields, setCustomFields] = useState<StoreCustomField[]>([]);
  const [newCustomLabel, setNewCustomLabel] = useState('');
  const [newCustomType, setNewCustomType] = useState<ProductFieldType>('text');
  const [newCustomRequired, setNewCustomRequired] = useState(false);
  const [newCustomOptions, setNewCustomOptions] = useState('');
  const [savingStoreType, setSavingStoreType] = useState(false);

  const customTypeLabel = (ty: ProductFieldType) => {
    const map: Record<ProductFieldType, string> = {
      text: t('productFields:custom.typeText'),
      number: t('productFields:custom.typeNumber'),
      select: t('productFields:custom.typeSelect'),
      date: t('productFields:custom.typeDate'),
      boolean: t('productFields:custom.typeBoolean'),
    };
    return map[ty];
  };

  const openStoreTypeDialog = () => {
    setStoreCategory(
      storeSettings?.businessCategory
        ? (BUSINESS_CATEGORIES.find((c) => c.id === storeSettings.businessCategory) ?? null)
        : null,
    );
    setStoreTypeSel(resolveStoreType(storeSettings?.businessCategory, storeSettings?.storeType));
    setCustomFields(storeSettings?.customFields ?? []);
    setNewCustomLabel('');
    setNewCustomType('text');
    setNewCustomRequired(false);
    setNewCustomOptions('');
    setStoreTypeDialog(true);
  };

  const pickStoreCategory = (cat: BusinessCategory) => {
    setStoreCategory(cat);
    setStoreTypeSel(cat.profile); // profil field produk ikut kategori
  };

  const addCustomField = () => {
    const label = newCustomLabel.trim();
    if (!label) return;
    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `f_${Date.now()}`;
    const used = new Set(customFields.map(cf => cf.key));
    while (used.has(key)) key = `${key}_${Math.floor(Math.random() * 1000)}`;
    const field: StoreCustomField = { key, label, type: newCustomType, required: newCustomRequired };
    if (newCustomType === 'select') {
      const opts = newCustomOptions.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.length > 0) field.options = opts;
    }
    setCustomFields([...customFields, field]);
    setNewCustomLabel('');
    setNewCustomOptions('');
  };

  const removeCustomField = (idx: number) => {
    setCustomFields(customFields.filter((_, i) => i !== idx));
  };

  const saveStoreType = async () => {
    if (!storeSettings?.id) return;
    setSavingStoreType(true);
    try {
      await db.storeSettings.update(storeSettings.id, {
        storeType: normalizeStoreType(storeTypeSel),
        businessCategory: storeCategory?.id,
        customFields: storeTypeSel === 'other' && customFields.length > 0 ? customFields : undefined,
      });
      await syncStoreEntryFromSettings({
        businessCategory: storeCategory?.id,
        storeType: normalizeStoreType(storeTypeSel),
      });
      toast.success(t('productFields:toast.saved'));
      setStoreTypeDialog(false);
    } finally {
      setSavingStoreType(false);
    }
  };


  // === Multi-user activation ===

  const openActivateDialog = () => {
    setActName('');
    setActUsername('');
    setActPin('');
    setActPinConfirm('');
    setActivateOpen(true);
  };

  const handleActivateMultiUser = async () => {
    if (!storeSettings?.id) return;
    if (!actName.trim()) { toast.error(t('toast.nameRequired')); return; }
    if (!isValidUsername(actUsername)) {
      toast.error(t('toast.usernameInvalid'));
      return;
    }
    if (!isValidPin(actPin)) {
      toast.error(t('toast.pinInvalid'));
      return;
    }
    if (actPin !== actPinConfirm) {
      toast.error(t('toast.pinMismatch'));
      return;
    }

    setActivating(true);
    try {
      // Check if owner already exists (idempotent — safety net)
      const existingOwner = await db.users.where('role').equals('owner').first();
      let ownerId = existingOwner?.id;

      if (!existingOwner) {
        const result = await createUser({
          username: actUsername,
          pin: actPin,
          name: actName,
          role: 'owner',
          permissions: [],
        });
        if (!result.ok) {
          toast.error(result.error || t('toast.createOwnerFailed'));
          return;
        }
        ownerId = result.userId;
      }

      // Flip the flag
      await db.storeSettings.update(storeSettings.id, { multiUserEnabled: true });

      // Persist session for the owner so they stay logged in immediately
      if (ownerId && storeSettings.deviceId) {
        saveSession(ownerId, storeSettings.deviceId);
      }

      toast.success(t('toast.multiUserEnabled'));
      setActivateOpen(false);
      // Reload so AuthProvider picks up the new session + flag from a clean state.
      window.location.reload();
    } finally {
      setActivating(false);
    }
  };

  const handleDisableMultiUser = async () => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { multiUserEnabled: false });
    setDisableOpen(false);
    toast.success(t('toast.multiUserDisabled'));
    // Force reload so AuthProvider re-evaluates state.
    window.location.reload();
  };

  const handleLogout = () => {
    logout();
    setLogoutOpen(false);
    // Reload to drop any in-memory state and route back to login screen cleanly.
    window.location.reload();
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const cloudStorageLimitMb = profile?.storageUsage.limitMb || BRAND.cloudStorageMb;

  return (
    <div className="px-4 pt-6 pb-4 space-y-5">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Settings className="w-5 h-5 text-primary" />
        {t('common:setting')}
      </h1>

      {/* Store Info */}
      <Card
        className={`border-0 shadow-sm ${can('manage_store_settings') ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
        onClick={() => can('manage_store_settings') && openStoreEdit()}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center overflow-hidden shrink-0">
            {storeSettings?.logo ? (
              <img src={storeSettings.logo} alt={t('storeDialog.logoPreviewAlt')} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{storeSettings?.storeName || t('storeFallback')}</p>
            <p className="text-xs text-muted-foreground">{storeSettings?.address || t('notSet')}</p>
          </div>
          {can('manage_store_settings') && <Edit2 className="w-4 h-4 text-muted-foreground" />}
        </CardContent>
      </Card>

      {/* Play Store alert ditunda — BRAND.playStoreEnabled === false (fokus PWA). */}

      {/* 1. Toko & Cloud — kartu pintu ke dashboard cloud.profitku.my.id */}
      <div className="space-y-2 mt-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.store')}</h2>
        {can('manage_backup') && (
          <a
            href={`${BRAND.cloudOrigin}${storeSettings?.cloudStoreId ? `/?store=${storeSettings.cloudStoreId}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Cloud className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{t('cloudDashboard.title')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('cloudDashboard.description')}</p>
                </div>
                <Button size="sm" className="h-8 text-xs shrink-0">
                  <Globe className="w-3.5 h-3.5 mr-1" />
                  {t('cloudDashboard.open')}
                </Button>
              </CardContent>
            </Card>
          </a>
        )}
        {can('manage_store_settings') && (
          <Card className="border-0 shadow-sm mb-2">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{t('productFields:settings.title')}</p>
                <p className="text-[10px] text-muted-foreground">{t('productFields:settings.desc')}</p>
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={openStoreTypeDialog}>
                {t('productFields:settings.change')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 2b. Affiliate — dashboard Mitra di Cloud Dashboard (konsolidasi 2026-08-16) */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.affiliate')}</h2>
        <a href={`${BRAND.cloudOrigin}/affiliate`} className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Share2 className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{t('affiliate.cardTitle')}</p>
                <p className="text-[10px] text-muted-foreground">{t('affiliate.cardDesc')}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </a>
      </div>

      {/* 3. Data & Backup */}
      {can('manage_backup') && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.data')}</h2>
          <SettingsLinkCard to="/settings/backup" icon={HardDrive} iconClass="bg-success/10 text-success" title={t('localBackup.title')} description={t('localBackup.description')} className="" />
        </div>
      )}

      {/* Install as App — hidden when already installed */}
      {!isNative && !isInstalled && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{t('installApp.title')}</p>
              <p className="text-[10px] text-muted-foreground">{t('installApp.hint')}</p>
            </div>
            {canInstall ? (
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={async () => {
                  const ok = await install();
                  if (ok) toast.success(t('installApp.installSuccess'));
                }}
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                {t('installApp.installButton')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setInstallHelpOpen(true)}
              >
                {t('installApp.helpButton')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5. Transaksi & Stok */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.transactionsAndStock')}</h2>
        <SettingsLinkCard to="/history" icon={Receipt} title={t('transactionsAndStock.transactionHistory.title')} description={t('transactionsAndStock.transactionHistory.description')} />
        {can('create_transaction') && (
          <SettingsLinkCard to="/shifts" icon={ClipboardCheck} title={t('shiftMenu.title')} description={t('shiftMenu.description')} />
        )}
        {can('manage_stock_inout') && (
          <>
            <SettingsLinkCard to="/stock-in" icon={ArrowDownToLine} iconClass="bg-success/10 text-success" title={t('transactionsAndStock.stockIn.title')} description={t('transactionsAndStock.stockIn.description')} />
            <SettingsLinkCard to="/stock-out" icon={ArrowUpFromLine} iconClass="bg-destructive/10 text-destructive" title={t('transactionsAndStock.stockOut.title')} description={t('transactionsAndStock.stockOut.description')} />
            <SettingsLinkCard to="/settings/stock-opname" icon={ClipboardCheck} title={t('stockOpname.title')} description={t('masterData.stockOpname.description')} />
          </>
        )}
        {(can('manage_expenses') || can('view_expenses')) && (
          <SettingsLinkCard to="/expenses" icon={Wallet} iconClass="bg-warning/10 text-warning" title={t('transactionsAndStock.expenses.title')} description={t('transactionsAndStock.expenses.description')} />
        )}
        {can('view_reports') && (
          <SettingsLinkCard to="/stock-report" icon={Package} title={t('transactionsAndStock.stockReport.title')} description={t('transactionsAndStock.stockReport.description')} className="" />
        )}
      </div>

      {/* 6. Pelanggan & Supplier */}
      {(can('manage_supplier') || can('manage_customers')) && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.people')}</h2>
          {can('manage_customers') && (
            <SettingsLinkCard to="/customers" icon={UsersIcon} title={t('transactionsAndStock.customers.title')} description={t('transactionsAndStock.customers.description')} />
          )}
          {can('manage_customers') && storeSettings?.allowDebt && (
            <SettingsLinkCard to="/debts" icon={HandCoins} iconClass="bg-warning/10 text-warning" title={t('transactionsAndStock.debts.title')} description={t('transactionsAndStock.debts.description', { count: activeDebts?.length ?? 0 })} />
          )}
          {can('manage_supplier') && (
            <SettingsLinkCard to="/supplier" icon={Truck} iconClass="bg-accent/10 text-accent" title={t('transactionsAndStock.supplier.title')} description={t('transactionsAndStock.supplier.description')} className="" />
          )}
        </div>
      )}

      {/* 7. Karyawan & Hak Akses */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.staff')}</h2>

        {multiUserEnabled && currentUser ? (
          <Card className="border-0 shadow-sm mb-2">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${currentUser.role === 'owner' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{currentUser.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  @{currentUser.username} · {currentUser.role === 'owner' ? t('employees.owner') : t('employees.staff')}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-destructive" onClick={() => setLogoutOpen(true)}>
                <LogOut className="w-3.5 h-3.5" />
                {t('employees.logout')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {isOwner && (
          !multiUserEnabled ? (
            <Card className="border-0 shadow-sm mb-2">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <UsersIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{t('employees.activate.title')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('employees.activate.description')}</p>
                </div>
                <Button size="sm" className="h-8 text-xs" onClick={openActivateDialog}>
                  {t('employees.activate.button')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <SettingsLinkCard to="/users" icon={UsersIcon} title={t('employees.manage.title')} description={t('employees.manage.description', { count: usersCount ?? 0 })} />
              {isOwner && (
                <SettingsLinkCard to="/settings/roles" icon={UserCog} iconClass="bg-accent/10 text-accent" title={t('employees.roles.title')} description={t('employees.roles.description')} />
              )}
              <Card className="border-0 shadow-sm mb-2">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{t('employees.active.title')}</p>
                    <p className="text-[10px] text-muted-foreground">{t('employees.active.description')}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => setDisableOpen(true)}>
                    {t('employees.active.disable')}
                  </Button>
                </CardContent>
              </Card>
            </>
          )
        )}


        {can('manage_store_settings') && (
          <Card className="border-0 shadow-sm mb-2">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center"><HandCoins className="w-4 h-4" /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{t('masterData.allowDebt.title')}</p>
                <p className="text-[10px] text-muted-foreground">{t('masterData.allowDebt.description')}</p>
              </div>
              <Switch checked={storeSettings?.allowDebt ?? false} onCheckedChange={handleToggleDebt} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* 8. Katalog & Master Data */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.catalog')}</h2>
        {can('manage_categories_payments') && (
          <SettingsLinkCard to="/settings/payment-methods" icon={CreditCard} title={t('masterData.paymentMethods.title')} description={t('masterData.paymentMethods.description', { count: paymentMethods?.length ?? 0 })} />
        )}

        {can('manage_categories_payments') && (
          <SettingsLinkCard to="/settings/product-category" icon={Tag} iconClass="bg-accent/10 text-accent" title={t('masterData.productCategory.title')} description={t('masterData.productCategory.description', { count: categories?.length ?? 0 })} />
        )}

        {can('manage_categories_payments') && (
          <SettingsLinkCard to="/settings/expense-category" icon={Wallet} iconClass="bg-warning/10 text-warning" title={t('masterData.expenseCategory.title')} description={t('masterData.expenseCategory.description', { count: expenseCategories?.length ?? 0 })} />
        )}

        <SettingsLinkCard to="/settings/units" icon={Ruler} title={t('masterData.units.title')} description={t('masterData.units.description', { count: units?.length ?? 0 })} />
      </div>

      {/* 9. Tampilan & Bantuan */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sections.appearance')}</h2>
        {can('manage_store_settings') && (
          <SettingsLinkCard to="/settings/receipt" icon={Receipt} title={t('masterData.receiptFooter.title')} description={t('masterData.receiptFooter.description')} />
        )}

        {can('manage_store_settings') && (
          <SettingsLinkCard to="/settings/theme" icon={Palette} iconClass="bg-accent/10 text-accent" title={t('masterData.theme.title')} description={t('masterData.theme.description')} />
        )}

        <Card className="border-0 shadow-sm mb-2">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{t('masterData.cashierLayout.title')}</p>
                <p className="text-[10px] text-muted-foreground">{t('masterData.cashierLayout.description')}</p>
              </div>
            </div>
            <Select value={cashierLayoutMode} onValueChange={handleCashierLayoutModeChange}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">{t('masterData.cashierLayout.grid')}</SelectItem>
                <SelectItem value="rows">{t('masterData.cashierLayout.rows')}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Link to="/settings/report-issue" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow mb-2">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{t('masterData.reportIssue.title')}</p>
                <p className="text-[10px] text-muted-foreground">{t('masterData.reportIssue.description')}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        {(actionButtonsConfig?.value?.telegram as { enabled?: boolean } | undefined)?.enabled !== false && (
        <a href={(actionButtonsConfig?.value?.telegram as { url?: string } | undefined)?.url || 'https://t.me/profitku'} target="_blank" rel="noopener noreferrer" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{t('masterData.telegramSupport.title')}</p>
                <p className="text-[10px] text-muted-foreground">{t('masterData.telegramSupport.description')}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </a>
        )}
      </div>

      {/* Bluetooth Printer (APK only) */}
      {isNative && can('manage_store_settings') && (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Printer className="w-4 h-4" /> {t('bluetoothPrinter.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t('bluetoothPrinter.default')}</p>
            {defaultPrinter ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{defaultPrinter.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{defaultPrinter.address}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={clearDefaultPrinter}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('bluetoothPrinter.notSelected')}</p>
            )}
          </div>

          <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={refreshPairedPrinters} disabled={loadingPrinters}>
            <Printer className="w-4 h-4" /> {loadingPrinters ? t('bluetoothPrinter.searching') : t('bluetoothPrinter.search')}
          </Button>

          {pairedPrinters.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('bluetoothPrinter.selectPrinter')}</p>
              {pairedPrinters.map(printer => {
                const isSelected = defaultPrinter?.address === printer.address;
                return (
                  <button
                    key={printer.address}
                    type="button"
                    onClick={() => selectDefaultPrinter(printer)}
                    className={`flex items-center justify-between w-full text-left rounded-lg border px-3 py-2 transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{printer.name || t('bluetoothPrinter.unnamed')}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{printer.address}</p>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground leading-snug">
            {t('bluetoothPrinter.hint')}
          </p>
        </CardContent>
      </Card>
      )}

      {/* Notifikasi push (OneSignal) */}
      {isPushSupported() && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Bell className="w-4 h-4" /> {t('pushSettings.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t('pushSettings.description')}
            </p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t('pushSettings.statusLabel')}</p>
                <p className="text-[11px] text-muted-foreground">
                  {pushState === 'granted' && t('pushSettings.status.granted')}
                  {pushState === 'denied' && t('pushSettings.status.denied')}
                  {pushState === 'default' && t('pushSettings.status.default')}
                  {pushState === 'off' && t('pushSettings.status.off')}
                </p>
              </div>
              {(pushState === 'default' || pushState === 'denied') && (
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() => {
                    if (pushState === 'denied' && !isNative) {
                      toast.info(t('pushSettings.openBrowserSettings'));
                      return;
                    }
                    requestPushPermission();
                    setTimeout(() => {
                      if (!isNative) setPushState(getPermissionState() === 'granted' ? 'granted' : getPermissionState() as 'default' | 'denied');
                      else void checkPushPermissionNative().then((ok) => setPushState(ok ? 'granted' : 'default'));
                    }, 800);
                  }}
                >
                  {t('pushSettings.enable')}
                </Button>
              )}
            </div>
            {!cloudLoggedIn && (
              <p className="text-[10px] text-muted-foreground">{t('pushSettings.needCloudLogin')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Privasi & Analitik */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><LineChart className="w-4 h-4" /> {t('privacyAnalytics.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5 pr-3">
              <Label className="text-sm">{t('privacyAnalytics.label')}</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {t('privacyAnalytics.description')}
              </p>
            </div>
            <Switch checked={analyticsOn} onCheckedChange={handleToggleAnalytics} />
          </div>
        </CardContent>
      </Card>

      {/* Bahasa */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Globe className="w-4 h-4" /> {t('language.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LanguageSwitcher />
        </CardContent>
      </Card>

      {/* About */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 text-center space-y-2">
           <p className="text-sm font-bold">{t('about.appName')}</p>
           <p className="text-xs text-muted-foreground">{t('about.tagline')}</p>
           <p className="text-[10px] text-muted-foreground">{t('about.version', { version: APP_VERSION })}</p>

           {/* Dynamic Action Buttons from API */}
           {actionButtonsConfig?.value && (
             <div className="flex flex-col gap-2 pt-2">
               {/* What's New Button */}
               {actionButtonsConfig.value.whatsNew && (actionButtonsConfig.value.whatsNew as { enabled?: boolean }).enabled && (
                 <button
                   type="button"
                   onClick={() => setWhatsNewOpen(true)}
                   className="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-primary/30 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                 >
                   <Sparkles className="w-3.5 h-3.5" />
                   {t('about.whatsNew')}
                   {unseenFeatures.length > 0 && (
                     <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                       {unseenFeatures.length}
                     </span>
                   )}
                 </button>
               )}

               {/* Request Feature Button */}
               {actionButtonsConfig.value.requestFeature && (actionButtonsConfig.value.requestFeature as { enabled?: boolean; url?: string }).enabled && (
                 <a
                   href={(actionButtonsConfig.value.requestFeature as { url?: string }).url || 'https://t.me/profitku'}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-border bg-muted/50 text-xs font-semibold text-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-colors"
                 >
                   {t('about.requestFeature')}
                 </a>
               )}

               {/* Donate Button */}
               {actionButtonsConfig.value.donate && (actionButtonsConfig.value.donate as { enabled?: boolean; url?: string }).enabled && (
                 <a
                   href={(actionButtonsConfig.value.donate as { url?: string }).url || 'mailto:support@profitku.my.id'}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-warning/30 bg-warning/5 text-xs font-semibold text-warning hover:bg-warning/10 transition-colors"
                 >
                   {t('about.donate')}
                 </a>
               )}

               {/* Telegram Button */}
               {actionButtonsConfig.value.telegram && (actionButtonsConfig.value.telegram as { enabled?: boolean; url?: string }).enabled && (
                 <a
                   href={(actionButtonsConfig.value.telegram as { url?: string }).url || 'https://t.me/profitku'}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-sky-500/30 bg-sky-500/5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors"
                 >
                   {t('about.telegram')}
                 </a>
               )}
             </div>
           )}

           {/* Split Storage Display: Local + Cloud */}
           <div className="pt-3 border-t space-y-3">
             {/* Local Storage (IndexedDB) */}
             {storageUsage && (
               <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                 <div className="flex items-center gap-2 mb-2">
                   <div className="w-7 h-7 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                     <Smartphone className="w-3.5 h-3.5" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-xs font-semibold text-foreground">{t('storage.local.title')}</p>
                     <p className="text-[10px] text-muted-foreground leading-tight">{t('storage.local.description')}</p>
                   </div>
                 </div>
                 <div className="space-y-1">
                   <div className="flex items-baseline justify-between text-[11px]">
                     <span className="text-muted-foreground">{t('about.storageUsed')}</span>
                     <span className="font-semibold">
                       {formatBytes(storageUsage.usage)} / {formatBytes(storageUsage.quota)}
                     </span>
                   </div>
                   <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                     <div
                       className="h-full bg-sky-500 rounded-full transition-all"
                       style={{ width: `${Math.min(100, (storageUsage.usage / storageUsage.quota) * 100)}%` }}
                     />
                   </div>
                   {storageUsage.usage / storageUsage.quota > 0.8 && (
                     <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-warning/10 border border-warning/20">
                       <AlertTriangle className="w-3 h-3 text-warning shrink-0 mt-0.5" />
                       <p className="text-[9px] text-warning leading-snug">
                         {t('storage.local.warning', { percent: Math.round((storageUsage.usage / storageUsage.quota) * 100) })}
                       </p>
                     </div>
                   )}
                 </div>
               </div>
             )}

             {/* Cloud Storage (R2 Backups) — only show if cloud subscribed */}
             {cloudLoggedIn && cloudSubscribed && profile?.storageUsage && (
               <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                 <div className="flex items-center gap-2 mb-2">
                   <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                     <Cloud className="w-3.5 h-3.5" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-xs font-semibold text-foreground">{t('storage.cloud.title')}</p>
                     <p className="text-[10px] text-muted-foreground leading-tight">
                        {t('storage.cloud.description', { limit: cloudStorageLimitMb })}
                     </p>
                   </div>
                 </div>
                 <div className="space-y-1">
                   <div className="flex items-baseline justify-between text-[11px]">
                     <span className="text-muted-foreground">{t('about.storageUsed')}</span>
                     <span className="font-semibold">
                        {profile.storageUsage.usedMb.toFixed(1)} MB / {cloudStorageLimitMb} MB
                     </span>
                   </div>
                   <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                     <div
                       className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.min(100, (profile.storageUsage.usedMb / cloudStorageLimitMb) * 100)}%` }}
                     />
                   </div>
                    {profile.storageUsage.usedMb / cloudStorageLimitMb > 0.8 && (
                     <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-warning/10 border border-warning/20">
                       <AlertTriangle className="w-3 h-3 text-warning shrink-0 mt-0.5" />
                       <p className="text-[9px] text-warning leading-snug">
                          {t('storage.cloud.warning', { percent: Math.round((profile.storageUsage.usedMb / cloudStorageLimitMb) * 100) })}
                       </p>
                     </div>
                   )}
                 </div>
               </div>
             )}

             {/* Cloud Not Active — show info card */}
             {!cloudSubscribed && (
               <div className="rounded-lg border border-muted bg-muted/30 p-3">
                 <div className="flex items-center gap-2 mb-1.5">
                   <div className="w-7 h-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                     <Cloud className="w-3.5 h-3.5" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-xs font-semibold text-foreground">{t('storage.cloud.title')}</p>
                   </div>
                 </div>
                 <p className="text-[10px] text-muted-foreground leading-snug">
                   {t('storage.cloud.needSubscription')}
                 </p>
               </div>
             )}
           </div>
        </CardContent>
      </Card>

      {/* Install Help Dialog */}
      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              {t('installHelp.title')}
            </DialogTitle>
            <DialogDescription>
              {t('installHelp.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {isIOS ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.iosStep1" components={{ strong: <strong /> }} />
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.iosStep2" components={{ strong: <strong />, 0: <Share2 className="w-3.5 h-3.5 inline mx-0.5" /> }} />
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.iosStep3" components={{ strong: <strong /> }} />
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.androidStep1" components={{ strong: <strong /> }} />
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.androidStep2" components={{ strong: <strong /> }} />
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</div>
                  <p className="text-sm flex-1">
                    <Trans i18nKey="settings:installHelp.androidStep3" components={{ strong: <strong /> }} />
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{t('installHelp.troubleshoot')}</span>
                </div>
              </div>
            )}
          </div>
          <Button className="w-full mt-2" variant="outline" onClick={() => setInstallHelpOpen(false)}>
            {t('common:close')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Store Dialog */}
      <Dialog open={storeDialog} onOpenChange={setStoreDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>{t('storeDialog.title')}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Logo picker */}
            <div className="space-y-1.5">
              <Label>{t('storeDialog.logoLabel')}</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {storeLogo ? (
                    <img src={storeLogo} alt={t('storeDialog.logoPreviewAlt')} className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {storeLogo ? t('storeDialog.logoChange') : t('storeDialog.logoSelect')}
                  </Button>
                  {storeLogo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive gap-1.5"
                      onClick={() => setStoreLogo(undefined)}
                    >
                      <X className="w-3.5 h-3.5" />
                      {t('storeDialog.logoRemove')}
                    </Button>
                  )}
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoSelect}
                />
              </div>
            </div>
            <div className="space-y-1.5"><Label>{t('storeDialog.storeName')}</Label><Input value={storeName} onChange={e => setStoreName(e.target.value)} className="h-11" /></div>
            <div className="space-y-1.5"><Label>{t('storeDialog.address')}</Label><Input value={storeAddr} onChange={e => setStoreAddr(e.target.value)} className="h-11" /></div>
            <div className="space-y-1.5"><Label>{t('storeDialog.phone')}</Label><Input value={storePhone} onChange={e => setStorePhone(e.target.value)} className="h-11" type="tel" /></div>
            <Button className="w-full h-11" onClick={saveStore}>{t('common:save')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Jenis Toko & Kolom Khusus Dialog (PRODUCT-TYPES) */}
      <Dialog open={storeTypeDialog} onOpenChange={setStoreTypeDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('productFields:settings.title')}</DialogTitle>
            <DialogDescription className="text-xs">{t('productFields:settings.desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>{t('productFields:catTitle')}</Label>
              <BusinessCategoryPicker
                selectedId={storeCategory?.id ?? null}
                onSelect={pickStoreCategory}
              />
              {storeCategory && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span>{storeCategory.icon}</span>
                  {t('productFields:catProfileHint', {
                    profile: t(`productFields:types.${storeCategory.profile}.name`),
                  })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {STORE_TYPES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setStoreTypeSel(st.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                    storeTypeSel === st.value
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

            {storeTypeSel === 'other' && (
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('productFields:custom.sectionTitle')}
                </p>
                {customFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('productFields:custom.empty')}</p>
                ) : (
                  customFields.map((cf, i) => (
                    <div key={cf.key} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cf.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {customTypeLabel(cf.type)}{cf.required ? ` · ${t('productFields:custom.required')}` : ''}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeCustomField(i)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <Input
                    value={newCustomLabel}
                    onChange={e => setNewCustomLabel(e.target.value)}
                    placeholder={t('productFields:custom.labelPlaceholder')}
                    className="h-10"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newCustomType} onValueChange={(v) => setNewCustomType(v as ProductFieldType)}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['text', 'number', 'select', 'date', 'boolean'] as const).map(ty => (
                          <SelectItem key={ty} value={ty}>{customTypeLabel(ty)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2 px-1">
                      <Label className="text-xs">{t('productFields:custom.required')}</Label>
                      <Switch checked={newCustomRequired} onCheckedChange={setNewCustomRequired} />
                    </div>
                  </div>
                  {newCustomType === 'select' && (
                    <Input
                      value={newCustomOptions}
                      onChange={e => setNewCustomOptions(e.target.value)}
                      placeholder={t('productFields:custom.optionsPlaceholder')}
                      className="h-10"
                    />
                  )}
                  <Button size="sm" className="h-9 w-full" onClick={addCustomField} disabled={!newCustomLabel.trim()}>
                    {t('productFields:custom.addButton')}
                  </Button>
                </div>
              </div>
            )}

            <Button className="w-full h-11" onClick={saveStoreType} disabled={savingStoreType}>
              {savingStoreType ? t('common:saving') : t('productFields:custom.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Multi-User Activation Dialog */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('employees.activateDialog.title')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('employees.activateDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('employees.activateDialog.nameLabel')} *</Label>
              <Input value={actName} onChange={e => setActName(e.target.value)} placeholder={t('employees.activateDialog.namePlaceholder')} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('employees.activateDialog.usernameLabel')} *</Label>
              <Input
                value={actUsername}
                onChange={e => setActUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                placeholder={t('employees.activateDialog.usernamePlaceholder')}
                className="h-11 font-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-[10px] text-muted-foreground">{t('employees.activateDialog.usernameHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('employees.activateDialog.pinLabel')} *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={actPin}
                onChange={e => setActPin(e.target.value.replace(/\D/g, ''))}
                placeholder={t('employees.activateDialog.pinPlaceholder')}
                className="h-11 font-mono text-center tracking-widest"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('employees.activateDialog.pinConfirmLabel')} *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={actPinConfirm}
                onChange={e => setActPinConfirm(e.target.value.replace(/\D/g, ''))}
                placeholder={t('employees.activateDialog.pinConfirmPlaceholder')}
                className="h-11 font-mono text-center tracking-widest"
              />
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-foreground">
              <p className="font-semibold mb-1">{t('employees.activateDialog.warningTitle')}</p>
              <p className="text-muted-foreground">
                {t('employees.activateDialog.warningText')}
              </p>
            </div>
            <Button className="w-full h-11" onClick={handleActivateMultiUser} disabled={activating}>
              {activating ? t('employees.activateDialog.submitting') : t('employees.activateDialog.submit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disable Multi-User Confirmation */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('employees.disableDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('employees.disableDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableMultiUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('employees.disableDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logout Confirmation */}
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('employees.logoutDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('employees.logoutDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('employees.logoutDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* What's New (manual open from Settings — show full catalog, do not auto-mark seen) */}
      <WhatsNewModal
        open={whatsNewOpen}
        onOpenChange={setWhatsNewOpen}
        features={FEATURES}
        markSeenOnClose={false}
      />
    </div>
  );
}
