import { useState, useRef, useEffect } from 'react';
import { Lock, User as UserIcon, Eye, EyeOff, Store, LogIn } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function LoginScreen() {
  const { t } = useTranslation('settings');
  const { login, loginCloud } = useAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  // Login cloud (C4): ID Toko + username + PIN
  const [cloudStoreCode, setCloudStoreCode] = useState('');
  const [cloudUsername, setCloudUsername] = useState('');
  const [cloudPin, setCloudPin] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await login(username, pin);
      if (!result.ok) {
        toast.error(result.error || t('loginScreen.loginFailed'));
        setPin('');
        pinRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloudSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      const result = await loginCloud(cloudStoreCode.trim().toUpperCase(), cloudUsername, cloudPin);
      if (!result.ok) {
        toast.error(result.error || t('loginScreen.loginFailed'));
        setCloudPin('');
      }
    } finally {
      setCloudBusy(false);
    }
  };

// Prefill ID Toko dari toko yang terhubung di device ini (best-effort).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await db.storeSettings.toCollection().first();
        const cloudStoreId = settings?.cloudStoreId;
        if (!cloudStoreId) return;
        const { fetchStores } = await import('@/lib/cloud-api');
        const stores = await fetchStores();
        const linked = stores.find((s) => s.id === cloudStoreId);
        if (linked?.storeCode && !cancelled) setCloudStoreCode(linked.storeCode);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-md mx-auto w-full">
        {/* Store header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 text-primary flex items-center justify-center overflow-hidden mb-3">
            {storeSettings?.logo ? (
              <img src={storeSettings.logo} alt={t('loginScreen.logoAlt')} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-8 h-8" />
            )}
          </div>
          <h1 className="text-xl font-bold">{storeSettings?.storeName || t('loginScreen.storeFallback')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('loginScreen.continuePrompt')}</p>
        </div>

        {/* Panel login (wireframe login-form: form dalam satu card) */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm px-5 py-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="flex items-center gap-1.5 text-sm">
              <UserIcon className="w-3.5 h-3.5" />
              {t('loginScreen.usernameLabel')}
            </Label>
            <Input
              id="username"
              ref={usernameRef}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('loginScreen.usernamePlaceholder')}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-12"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin" className="flex items-center gap-1.5 text-sm">
              <Lock className="w-3.5 h-3.5" />
              {t('loginScreen.pinLabel')}
            </Label>
            <div className="relative">
              <Input
                id="pin"
                ref={pinRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder={t('loginScreen.pinPlaceholder')}
                autoComplete="current-password"
                className="h-12 pr-12 tracking-widest font-mono text-center text-lg"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPin ? t('loginScreen.hidePin') : t('loginScreen.showPin')}
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full h-12 text-base font-semibold mt-2"
            disabled={submitting || !username.trim() || pin.length < 4}
          >
            <LogIn className="w-4 h-4 mr-2" />
            {submitting ? t('loginScreen.loggingIn') : t('loginScreen.loginButton')}
          </Button>
        </form>

        {/* Pemisah */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('loginScreen.cloudDivider')}
            </span>
          </div>
        </div>

{/* Login cloud (C4): ID Toko + username + PIN */}
        <form onSubmit={handleCloudSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cloud-store-code" className="flex items-center gap-1.5 text-sm">
              <Store className="w-3.5 h-3.5" />
              {t('loginScreen.cloudStoreCodeLabel')}
            </Label>
            <Input
              id="cloud-store-code"
              value={cloudStoreCode}
              onChange={(e) => setCloudStoreCode(e.target.value.toUpperCase())}
              placeholder={t('loginScreen.cloudStoreCodePlaceholder')}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="h-12 text-center tracking-widest font-mono"
              disabled={cloudBusy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cloud-username" className="flex items-center gap-1.5 text-sm">
              <UserIcon className="w-3.5 h-3.5" />
              {t('loginScreen.cloudUsernameLabel')}
            </Label>
            <Input
              id="cloud-username"
              value={cloudUsername}
              onChange={(e) => setCloudUsername(e.target.value)}
              placeholder={t('loginScreen.cloudUsernamePlaceholder')}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-12"
              disabled={cloudBusy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cloud-pin" className="flex items-center gap-1.5 text-sm">
              <Lock className="w-3.5 h-3.5" />
              {t('loginScreen.cloudPinLabel')}
            </Label>
            <Input
              id="cloud-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={cloudPin}
              onChange={(e) => setCloudPin(e.target.value.replace(/\D/g, ''))}
              placeholder={t('loginScreen.pinPlaceholder')}
              autoComplete="current-password"
              className="h-12 tracking-widest font-mono text-center text-lg"
              disabled={cloudBusy}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className="w-full h-12 text-base font-semibold mt-2"
            disabled={cloudBusy || !cloudStoreCode.trim() || !cloudUsername.trim() || cloudPin.length < 4}
          >
            <LogIn className="w-4 h-4 mr-2" />
            {cloudBusy ? t('loginScreen.loggingIn') : t('loginScreen.cloudLoginButton')}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            {t('loginScreen.cloudHint')}
          </p>
        </form>
        </div>


        <p className="text-[11px] text-muted-foreground text-center mt-6">
          {t('loginScreen.forgotPin')}
        </p>
      </div>
    </div>
  );
}
