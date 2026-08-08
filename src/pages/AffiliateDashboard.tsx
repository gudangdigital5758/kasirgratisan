import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  Share2,
  TreePine,
  User,
  Users,
} from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { format } from 'date-fns';
import { id, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  fetchAffiliateMe,
  fetchAffiliateTree,
  fetchAffiliateCommissions,
  registerAffiliate,
  type AffiliateMeResult,
  type AffiliateTreeResult,
  type AffiliateCommissionsResult,
} from '@/lib/cloud-api';
import { getAffiliateRef } from '@/lib/affiliate';

const LOCALES: Record<string, Locale> = { id, en: enUS, ms };
const CURRENCY_SYMBOL: Record<string, string> = { id: 'Rp', en: 'Rp', ms: 'Rp' };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

type Tab = 'overview' | 'tree' | 'commissions';

const TIER_COLORS = ['bg-amber-500/10 text-amber-600 border-amber-500/20', 'bg-sky-500/10 text-sky-600 border-sky-500/20', 'bg-violet-500/10 text-violet-600 border-violet-500/20', 'bg-rose-500/10 text-rose-600 border-rose-500/20', 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'];

/** Tab navigasi sederhana (tanpa dep shadcn tabs agar ringkas). */
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 flex-1 rounded-xl border-2 py-2.5 text-xs font-semibold transition-all',
        active ? 'border-primary bg-primary/5 text-primary shadow-sm' : 'border-border text-muted-foreground hover:border-primary/30 hover:bg-muted/50'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export default function AffiliateDashboard() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('settings');
  const { isLoggedIn, login } = useCloudAuth();
  const dateLocale = LOCALES[i18n.language] ?? id;
  const currencySymbol = CURRENCY_SYMBOL[i18n.language] ?? 'Rp';
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const rp = (n: number) => `${currencySymbol} ${n.toLocaleString(numberLocale)}`;

  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<AffiliateMeResult | null>(null);
  const [tree, setTree] = useState<AffiliateTreeResult | null>(null);
  const [commissions, setCommissions] = useState<AffiliateCommissionsResult | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // State pendaftaran (user login tapi belum register affiliate)
  const [regName, setRegName] = useState('');
  const [regBusy, setRegBusy] = useState(false);

  const loadAll = async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const meData = await fetchAffiliateMe();
      setMe(meData);
      if (meData.registered) {
        const [treeData, commData] = await Promise.all([
          fetchAffiliateTree().catch(() => null),
          fetchAffiliateCommissions().catch(() => null),
        ]);
        setTree(treeData);
        setCommissions(commData);
      }
    } catch (err) {
      console.warn('[affiliate] gagal memuat data', err);
      toast.error(t('affiliate.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (googleIdToken: string) => {
    try {
      await login(googleIdToken);
      await loadAll();
    } catch (err) {
      console.warn('[affiliate] login gagal', err);
      toast.error(t('affiliate.loginFailed'));
    }
  };

  const handleRegister = async () => {
    if (!regName.trim()) {
      toast.error(t('affiliate.registerNameRequired'));
      return;
    }
    setRegBusy(true);
    try {
      const ref = getAffiliateRef();
      await registerAffiliate({ name: regName.trim(), refCode: ref?.code ?? undefined });
      toast.success(t('affiliate.registerSuccess'));
      await loadAll();
    } catch (err) {
      console.warn('[affiliate] register gagal', err);
      toast.error(err instanceof Error ? err.message : t('affiliate.registerFailed'));
    } finally {
      setRegBusy(false);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('affiliate.copySuccess'));
    } catch {
      toast.error(t('affiliate.copyFailed'));
    }
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Share2 className="w-5 h-5 text-primary" />
          {t('affiliate.title')}
        </h1>
      </div>

      {/* === State: belum login cloud === */}
      {!isLoggedIn && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Share2 className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{t('affiliate.loginTitle')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t('affiliate.loginDesc')}</p>
            </div>
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={({ credential }) => {
                  if (credential) void handleLogin(credential);
                }}
                onError={() => toast.error(t('affiliate.loginFailed'))}
                useOneTap={false}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('affiliate.tiersHint')}: 20% + 5% × 4 = 40%
            </p>
          </CardContent>
        </Card>
      )}

      {/* === State: loading data === */}
      {isLoggedIn && loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm">{t('affiliate.loading')}</span>
        </div>
      )}

      {/* === State: login tapi belum register affiliator === */}
      {isLoggedIn && !loading && me && !me.registered && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                {t('affiliate.registerTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{t('affiliate.registerDesc')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('affiliate.registerNameLabel')} *</Label>
              <Input
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder={t('affiliate.registerNamePlaceholder')}
                className="h-11"
              />
            </div>
            <Button className="w-full h-11 gap-1.5" onClick={() => void handleRegister()} disabled={regBusy}>
              {regBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t('affiliate.registerButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* === State: affiliator terdaftar — dashboard === */}
      {isLoggedIn && !loading && me?.registered && me.affiliate && (
        <div className="space-y-4">
          {/* Kartu profil + link referral */}
          <Card className="border-0 shadow-sm bg-gradient-to-br from-primary/10 via-background to-background">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold">{me.affiliate.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('affiliate.joinedAt')} {format(new Date(me.affiliate.createdAt), 'dd MMM yyyy', { locale: dateLocale })}
                  </p>
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] gap-1">
                  <span className="text-primary">REF</span>
                  {me.affiliate.code}
                </Badge>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">{t('affiliate.yourLink')}</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly value={me.link} className="font-mono text-xs h-9" />
                  <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5" onClick={() => void copyLink(me.link)}>
                    <Copy className="w-3.5 h-3.5" />
                    {t('affiliate.copy')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ringkasan komisi */}
          {commissions && (
            <div className="grid grid-cols-2 gap-2">
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('affiliate.totalEarned')}</p>
                  <p className="text-xl font-bold text-primary mt-0.5">{rp(commissions.totals.earnedIdr)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t('affiliate.paid')}: <span className="font-medium text-emerald-600 dark:text-emerald-400">{rp(commissions.totals.paidIdr)}</span>
                  </p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('affiliate.networkSize')}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Users className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                    <p className="text-xl font-bold">{Object.values(commissions.summary ?? {}).reduce((s, x) => s + x.count, 0)}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t('affiliate.referrals')}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigasi tab */}
          <div className="flex gap-2">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Share2 className="w-4 h-4" />} label={t('affiliate.tabOverview')} />
            <TabButton active={tab === 'tree'} onClick={() => setTab('tree')} icon={<TreePine className="w-4 h-4" />} label={t('affiliate.tabTree')} />
            <TabButton active={tab === 'commissions'} onClick={() => setTab('commissions')} icon={<CreditCard className="w-4 h-4" />} label={t('affiliate.tabCommissions')} />
          </div>

          {/* Tab: Overview — skema tier */}
          {tab === 'overview' && me.tiers.length > 0 && (
            <div className="space-y-2">
              {me.tiers.map((tier) => (
                <Card key={tier.tier} className={cn('border-0 shadow-sm', TIER_COLORS[(tier.tier - 1) % TIER_COLORS.length])}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center text-sm font-bold">{tier.tier}</div>
                      <div>
                        <p className="text-sm font-semibold">{t('affiliate.tierLabel', { tier: tier.tier })}</p>
                        <p className="text-[11px] text-muted-foreground">{tier.description || t('affiliate.tierDefaultDesc', { tier: tier.tier })}</p>
                      </div>
                    </div>
                    <p className="text-lg font-bold">{tier.percent}%</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Tab: Pohon referral */}
          {tab === 'tree' && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                {tree?.tree?.users?.length ? (
                  <div className="space-y-2">
                    {tree.tree.users.map((u) => (
                      <div key={u.id} className="rounded-xl border border-border p-3">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{u.name || u.email}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">{u.code}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-primary">{rp(u.commission.earnedIdr)}</p>
                            <p className="text-[10px] text-muted-foreground">{u.commission.count} ×</p>
                          </div>
                        </div>
                        {u.children.length > 0 && (
                          <div className="mt-2 ml-3 pl-3 border-l border-border space-y-2">
                            {u.children.map((c) => (
                              <div key={c.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">{c.name || c.email}</p>
                                  <p className="text-[10px] text-muted-foreground font-mono">{c.code}</p>
                                </div>
                                <p className="text-xs font-semibold text-primary shrink-0">{rp(c.commission.earnedIdr)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <TreePine className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {t('affiliate.treeEmpty')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tab: Detail komisi */}
          {tab === 'commissions' && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                {commissions?.commissions?.length ? (
                  <div className="space-y-2">
                    {commissions.commissions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{rp(c.commissionIdr)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t('affiliate.commissionFrom', { amount: rp(c.amountPaid), percent: c.ratePercent })}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-[9px] h-4',
                              c.status === 'paid' && 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                              c.status === 'earned' && 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                              c.status === 'void' && 'bg-destructive/10 text-destructive border-destructive/20'
                            )}
                          >
                            {t(`affiliate.status.${c.status}`)}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Tier {c.tier} · {format(new Date(c.createdAt), 'dd MMM yyyy', { locale: dateLocale })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {t('affiliate.commissionsEmpty')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
