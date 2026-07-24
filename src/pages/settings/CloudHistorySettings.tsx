import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, History, CreditCard, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id as idLocale, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { fetchPaymentHistory, verifyPayment, type PaymentTransaction } from '@/lib/cloud-api';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 10;
const LOCALES: Record<string, Locale> = { id: idLocale, en: enUS, ms };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

export default function CloudHistorySettings() {
  const { can } = useAuth();
  const { isLoggedIn, refreshProfile } = useCloudAuth();
  const { t, i18n } = useTranslation('settings');
  const dateLocale = LOCALES[i18n.language] ?? idLocale;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const rp = (n: number) => `Rp ${n.toLocaleString(numberLocale)}`;

  const STATUS_LABEL: Record<string, string> = {
    COMPLETED: t('cloudHistory.status.completed'),
    PENDING: t('cloudHistory.status.pending'),
    FAILED: t('cloudHistory.status.failed'),
  };
  const STATUS_COLOR: Record<string, string> = { COMPLETED: 'text-success', PENDING: 'text-warning', FAILED: 'text-destructive' };

  const [history, setHistory] = useState<PaymentTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const { items, pagination } = await fetchPaymentHistory({ page: p, limit: PAGE_SIZE });
      setHistory((prev) => (append ? [...prev, ...items] : items));
      setPage(pagination.page);
      setHasMore(pagination.hasMore);
    } catch {
      /* diabaikan */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) load(1, false);
  }, [isLoggedIn, load]);

  if (!can('manage_backup')) {
    return <LockedPage title={t('cloudHistory.locked.title')} permissionLabel={t('cloudHistory.locked.permissionLabel')} />;
  }

  const handleCheckPayment = async (txId: string) => {
    setBusy(`verify:${txId}`);
    try {
      const result = await verifyPayment(txId);
      await load(1, false);
      if (result.transaction.status === 'COMPLETED') {
        await refreshProfile();
        toast.success(t('cloudHistory.toast.paymentSuccess'));
      } else {
        toast.info(t('cloudHistory.toast.pending'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudHistory.toast.verifyFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings/cloud">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          {t('cloudHistory.title')}
        </h1>
      </div>

      {!isLoggedIn ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">{t('cloudHistory.loginPrompt')}</CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-2">
            {loading && history.length === 0 ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">{t('cloudHistory.noTransactions')}</p>
            ) : (
              <>
                {history.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{tx.plan?.name ?? tx.planId}</p>
                      <p className="text-[10px] text-muted-foreground">{format(new Date(tx.createdAt), 'dd MMM yyyy HH:mm', { locale: dateLocale })}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-xs font-bold">{rp(tx.amount)}</p>
                        <span className={`text-[10px] font-semibold ${STATUS_COLOR[tx.status] ?? 'text-muted-foreground'}`}>
                          {STATUS_LABEL[tx.status] ?? tx.status}
                        </span>
                      </div>
                      {tx.status === 'PENDING' && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={busy === `verify:${tx.id}`} onClick={() => handleCheckPayment(tx.id)}>
                          {busy === `verify:${tx.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                          {t('cloudHistory.checkButton')}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {hasMore && (
                  <Button variant="ghost" size="sm" className="w-full h-8 text-xs" disabled={loading} onClick={() => load(page + 1, true)}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudHistory.loadMore')}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
