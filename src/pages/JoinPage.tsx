import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { ArrowRight, CheckCircle2, Copy, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { claimAffiliateRef } from '@/lib/affiliate';
import { fetchAffiliateMe, lookupAffiliate, type AffiliateMeResult } from '@/lib/cloud-api';
import { isNativePlatform } from '@/lib/printer';
import { nativeGoogleSignIn } from '@/lib/google-auth';
import { useTranslation } from 'react-i18next';

/**
 * Halaman aktivasi akun gratis — target link referral /join?ref=KODE.
 * Fokus: akun Profitku + kode referral pribadi, BUKAN checkout Cloud.
 * Setelah OAuth: claim idempotent (kunci user ke pengundang + auto-register
 * affiliator) lalu tampilkan kode REF sendiri + CTA masuk aplikasi.
 */
export default function JoinPage() {
  const { t } = useTranslation('settings');
  const { isLoggedIn, login } = useCloudAuth();
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<AffiliateMeResult | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || '';
    if (!code) return;
    lookupAffiliate(code)
      .then((r) => {
        if (r.valid && r.name) setReferrerName(r.name);
      })
      .catch(() => {
        /* lookup best-effort */
      });
  }, []);

  // SEO route metadata: canonical bersih (tanpa ?ref), title/description route,
  // OG & Twitter. Di-restore saat unmount agar halaman lain kembali ke meta umum.
  useEffect(() => {
    const setAttr = (sel: string, attr: string, value: string) => {
      const el = document.head.querySelector(sel);
      if (el) el.setAttribute(attr, value);
    };
    const snap = (sel: string, attr: string) => document.head.querySelector(sel)?.getAttribute(attr) ?? '';
    const JOIN_URL = 'https://profitku.my.id/join';
    const title = t('join.metaTitle');
    const desc = t('join.metaDescription');
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ['meta[name="description"]', 'content', desc],
      ['link[rel="canonical"]', 'href', JOIN_URL],
      ['meta[property="og:url"]', 'content', JOIN_URL],
      ['meta[property="og:title"]', 'content', title],
      ['meta[property="og:description"]', 'content', desc],
      ['meta[property="twitter:url"]', 'content', JOIN_URL],
      ['meta[property="twitter:title"]', 'content', title],
      ['meta[property="twitter:description"]', 'content', desc],
    ];
    const prevTitle = document.title;
    const prev = pairs.map(([sel, attr]) => [sel, attr, snap(sel, attr)] as const);
    document.title = title;
    for (const [sel, attr, value] of pairs) setAttr(sel, attr, value);
    return () => {
      document.title = prevTitle;
      for (const [sel, attr, value] of prev) setAttr(sel, attr, value);
    };
  }, [t]);

  const finishJoin = async () => {
    // Claim idempotent — pastikan selesai sebelum membaca profil affiliate.
    await claimAffiliateRef();
    let result: AffiliateMeResult | null = null;
    for (let i = 0; i < 5; i++) {
      result = await fetchAffiliateMe().catch(() => null);
      if (result?.registered) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    setMe(result);
  };

  useEffect(() => {
    // Sesi sudah ada (restore) — langsung selesaikan join tanpa klik OAuth.
    if (isLoggedIn && !me) void finishJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handleWebSuccess = async (credential?: string) => {
    if (!credential) {
      toast.error(t('join.loginFailed'));
      return;
    }
    setBusy(true);
    try {
      await login(credential);
      await finishJoin();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('join.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleNativeLogin = async () => {
    setBusy(true);
    try {
      const idToken = await nativeGoogleSignIn();
      await login(idToken);
      await finishJoin();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('join.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!me?.link) return;
    try {
      await navigator.clipboard.writeText(me.link);
      toast.success(t('join.copied'));
    } catch {
      toast.error(t('join.copyFailed'));
    }
  };

  const isAffiliate = me?.registered === true;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2">
          <Share2 className="w-5 h-5 text-primary" />
          <span className="text-sm font-bold tracking-wide">Profitku</span>
        </div>

        {isAffiliate ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-4 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-success/10 text-success flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-bold leading-tight">{t('join.successTitle')}</h1>
                <p className="text-xs text-muted-foreground leading-relaxed">{t('join.successDesc')}</p>
              </div>

              {me?.affiliate?.code && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">{t('join.yourCode')}</p>
                  <p className="font-mono text-lg font-bold tracking-widest text-primary">{me.affiliate.code}</p>
                </div>
              )}

              {me?.link && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground font-medium">{t('join.yourLink')}</p>
                  <div className="flex gap-2">
                    <p className="flex-1 min-w-0 truncate text-[11px] font-mono text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2 text-left">
                      {me.link}
                    </p>
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => void copyLink()}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="pt-1 space-y-2">
                <Link to="/" className="block">
                  <Button className="w-full h-11 gap-1.5 font-semibold">
                    {t('join.startApp')} <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link to="/affiliate" className="block">
                  <Button variant="outline" className="w-full h-10 gap-1.5">
                    <Share2 className="w-4 h-4" /> {t('join.openAffiliate')}
                  </Button>
                </Link>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">{t('join.cloudNote')}</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="space-y-1 text-center">
                <h1 className="text-lg font-bold leading-tight">{t('join.title')}</h1>
                {referrerName && (
                  <p className="text-[11px] font-medium text-primary">{t('join.invitedBy', { name: referrerName })}</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('join.benefitsTitle')}
                </p>
                <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                  {[t('join.benefit1'), t('join.benefit2'), t('join.benefit3'), t('join.benefit4')].map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-center pt-1">
                {isNativePlatform() ? (
                  <Button className="h-11 gap-2 w-full max-w-[260px]" disabled={busy} onClick={() => void handleNativeLogin()}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                    {t('cloudBackup.continueWithGoogle')}
                  </Button>
                ) : (
                  <GoogleLogin
                    onSuccess={(cr) => void handleWebSuccess(cr.credential)}
                    onError={() => toast.error(t('join.loginFailed'))}
                    useOneTap={false}
                  />
                )}
              </div>

              <p className="text-center text-[10px] text-muted-foreground leading-relaxed">{t('join.freeNote')}</p>

              {isLoggedIn && !busy && !me && (
                <p className="text-center text-[11px] text-muted-foreground">{t('join.accountActive')}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
