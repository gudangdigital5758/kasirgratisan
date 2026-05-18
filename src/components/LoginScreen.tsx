import { useState, useRef, useEffect } from 'react';
import { Lock, User as UserIcon, Eye, EyeOff, Store, LogIn } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function LoginScreen() {
  const { login } = useAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

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
        toast.error(result.error || 'Login gagal');
        setPin('');
        pinRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-md mx-auto w-full">
        {/* Store header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 text-primary flex items-center justify-center overflow-hidden mb-3">
            {storeSettings?.logo ? (
              <img src={storeSettings.logo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Store className="w-8 h-8" />
            )}
          </div>
          <h1 className="text-xl font-bold">{storeSettings?.storeName || 'KasirGratisan'}</h1>
          <p className="text-xs text-muted-foreground mt-1">Masuk untuk melanjutkan</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="flex items-center gap-1.5 text-sm">
              <UserIcon className="w-3.5 h-3.5" />
              Username
            </Label>
            <Input
              id="username"
              ref={usernameRef}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Contoh: budi"
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
              PIN
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
                placeholder="4-6 digit"
                autoComplete="current-password"
                className="h-12 pr-12 tracking-widest font-mono text-center text-lg"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
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
            {submitting ? 'Masuk…' : 'Masuk'}
          </Button>
        </form>

        <p className="text-[11px] text-muted-foreground text-center mt-6">
          Lupa PIN? Hubungi pemilik toko untuk reset.
        </p>
      </div>
    </div>
  );
}
