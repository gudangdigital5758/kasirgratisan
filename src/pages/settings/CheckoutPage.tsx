import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, ExternalLink, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import {
  createStore,
  checkoutBatch,
  verifyPayment,
  previewVoucher,
  CLOUD_DURATIONS,
  type VoucherPreviewResult,
} from '@/lib/cloud-api';
import { updateStore } from '@/lib/store-registry';
import { getAffiliateRef } from '@/lib/affiliate';
import type { CheckoutCartItem } from '@/lib/checkout-cart';

const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

/**
 * Detail Pembayaran — checkout batch (Daftar Toko).
 * Ringkasan item (tingkatkan/perpanjang), voucher, total; tombol
 * Lanjutkan Pembayaran membuka halaman QRIS SumoPod + polling status.
 */
export default function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation('settings');
  const { refreshProfile } = useCloudAuth();
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';

  const items = (location.state as { items?: CheckoutCartItem[] } | null)?.items ?? [];
  const validItems = items.filter((i) => i.action === 'subscribe' || i.action === 'renew');

  const [voucherInput, setVoucherInput] = useState('');
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreviewResult | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [pendingTxId, setPendingTxId] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'PENDING' | 'COMPLETED' | 'FAILED'>('PENDING');
  const pollRef = useRef<number | null>(null);

  const subtotal = validItems.reduce((sum, i) => {
    const d = CLOUD_DURATIONS.find((x) => x.months === i.durationMonths);
    return sum + (d?.price ?? 0);
  }, 0);
  const rp = (n: number) => `Rp ${n.toLocaleString(numberLocale)}`;
  const actionLabel = (a: 'subscribe' | 'renew') =>
    a === 'renew' ? t('checkout.itemActionRenew') : t('checkout.itemActionUpgrade');

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const checkPayment = useCallback(
    async (silent = false) => {
      if (!pendingTxId) return;
      try {
        const res = await verifyPayment(pendingTxId);
        if (res.transaction.status === 'COMPLETED') {
          stopPolling();
          setPaymentStatus('COMPLETED');
          await refreshProfile();
          toast.success(t('checkout.success'));
          window.setTimeout(() => navigate('/settings/stores'), 900);
        } else if (res.transaction.status === 'FAILED') {
          stopPolling();
          setPaymentStatus('FAILED');
          toast.error(t('checkout.failed'));
        } else if (!silent) {
          toast.info(t('checkout.stillPending'));
        }
      } catch {
        if (!silent) toast.error(t('checkout.checkFailed'));
      }
    },
    [pendingTxId, refreshProfile, navigate, t],
  );

  const applyVoucher = async () => {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;
    setVoucherBusy(true);
    try {
      const preview = await previewVoucher(code, 'cloud_monthly');
      if (!preview.valid) {
        toast.error(preview.error || t('cloudBackup.voucher.invalid'));
        setVoucherPreview(null);
      } else {
        setVoucherPreview(preview);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('checkout.checkFailed'));
    } finally {
      setVoucherBusy(false);
    }
  };

  const handleCheckout = async () => {
    if (validItems.length === 0) return;
    setBusy(true);
    try {
      // Item subscribe tanpa cloudStoreId: buat cloud store + ikat registry lokal.
      const resolved: CheckoutCartItem[] = [];
      for (const it of validItems) {
        if (it.action === 'subscribe' && !it.cloudStoreId) {
          const cloud = await createStore(it.name);
          await updateStore(it.storeKey, { mode: 'cloud', cloudStoreId: cloud.id });
          resolved.push({ ...it, cloudStoreId: cloud.id });
        } else {
          resolved.push(it);
        }
      }
      const result = await checkoutBatch(
        resolved.map((it) => ({
          storeId: it.cloudStoreId!,
          action: it.action,
          durationMonths: it.durationMonths,
        })),
        {
          redirectURL: `${window.location.origin}/settings/stores`,
          voucherCode:
            voucherPreview?.valid && voucherPreview.code
              ? voucherPreview.code
              : voucherInput.trim() || undefined,
          affiliateCode: getAffiliateRef()?.code,
          affiliateCapturedAt: getAffiliateRef()?.capturedAt,
        },
      );
      if (result.completed || result.transaction.status === 'COMPLETED') {
        await refreshProfile();
        toast.success(result.message || t('checkout.success'));
        navigate('/settings/stores');
        return;
      }
      setAmount(result.transaction.amount);
      setPendingTxId(result.transaction.id);
      setPaymentLink(result.paymentLink);
      if (result.paymentLink) window.open(result.paymentLink, '_blank');
      setPaymentStatus('PENDING');
      pollRef.current = window.setInterval(() => void checkPayment(true), 4000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('checkout.checkoutFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (validItems.length === 0) {
    return (
      <div className="px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings/stores')}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-xl font-bold">{t('checkout.title')}</h1>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{t('checkout.empty')}</p>
            <Button variant="outline" className="h-9 text-xs" onClick={() => navigate('/settings/stores')}>
              {t('checkout.back')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-24 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings/stores')}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold">{t('checkout.title')}</h1>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">{t('checkout.itemTitle')}</h2>
          {validItems.map((it, idx) => {
            const d = CLOUD_DURATIONS.find((x) => x.months === it.durationMonths);
            return (
              <div key={`${it.storeKey}-${idx}`} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium truncate">{it.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {actionLabel(it.action)} · {it.durationMonths} {t('checkout.month')}
                  </p>
                </div>
                <p className="shrink-0">{rp(d?.price ?? 0)}</p>
              </div>
            );
          })}
          <div className="border-t border-border/60 pt-2 flex items-center justify-between">
            <p className="text-xs font-medium">{t('checkout.subtotal')}</p>
            <p className="text-sm font-bold">{rp(subtotal)}</p>
          </div>
          {amount !== null && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{t('checkout.total')}</p>
              <p className="text-sm font-bold text-primary">{rp(amount)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold">{t('cloudBackup.voucher.title')}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={voucherInput}
              onChange={(e) => setVoucherInput(e.target.value)}
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
              onClick={applyVoucher}
            >
              {voucherBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('cloudBackup.voucher.apply')}
            </Button>
          </div>
          {voucherPreview?.valid && (
            <p className="text-xs text-success leading-snug">{voucherPreview.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{t('checkout.voucherNote')}</p>
        </CardContent>
      </Card>

      {!pendingTxId ? (
        <Button className="w-full h-11 gap-1.5" onClick={handleCheckout} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {t('checkout.continue')}
        </Button>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-3 text-center">
            {paymentStatus === 'COMPLETED' ? (
              <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            ) : paymentStatus === 'FAILED' ? (
              <XCircle className="w-10 h-10 text-destructive mx-auto" />
            ) : (
              <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" style={{ animationDuration: '1.5s' }} />
            )}
            <p className="text-sm font-medium">
              {paymentStatus === 'COMPLETED'
                ? t('checkout.success')
                : paymentStatus === 'FAILED'
                  ? t('checkout.failed')
                  : t('checkout.waiting')}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">{t('checkout.waitingDesc')}</p>
            <div className="space-y-2">
              <Button
                className="w-full h-10 gap-2"
                disabled={paymentStatus !== 'PENDING'}
                onClick={() => checkPayment(false)}
              >
                <CheckCircle2 className="w-4 h-4" /> {t('checkout.checkPaid')}
              </Button>
              {paymentLink && (
                <Button
                  variant="outline"
                  className="w-full h-10 gap-2"
                  onClick={() => paymentLink && window.open(paymentLink, '_blank')}
                >
                  <ExternalLink className="w-4 h-4" /> {t('checkout.openPayment')}
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full h-9 text-muted-foreground"
                onClick={() => {
                  stopPolling();
                  navigate('/settings/stores');
                }}
              >
                {t('checkout.back')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
