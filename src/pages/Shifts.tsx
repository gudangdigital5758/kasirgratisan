import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, type Locale } from 'date-fns';
import { id, enUS, ms } from 'date-fns/locale';
import {
  ChevronLeft,
  Clock,
  DoorOpen,
  DoorClosed,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { db } from '@/lib/db';
import {
  closeShift,
  computeShiftTotals,
  getOpenShift,
  openShift,
  shiftVariance,
} from '@/lib/shift';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const LOCALES: Record<string, Locale> = { id, en: enUS, ms };
const NUMBER_LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };
const CURRENCY: Record<string, string> = { id: 'Rp', en: 'Rp', ms: 'Rp' };

export default function ShiftsPage() {
  const { currentUser, multiUserEnabled, can } = useAuth();
  const { t, i18n } = useTranslation('shifts');
  const dateLocale = LOCALES[i18n.language] ?? id;
  const numberLocale = NUMBER_LOCALES[i18n.language] ?? 'id-ID';
  const currency = CURRENCY[i18n.language] ?? 'Rp';
  const rp = (n: number) => `${currency} ${n.toLocaleString(numberLocale)}`;

  const userId = currentUser?.id ?? null;
  const userName = currentUser?.name || t('fallbackCashier');

  const openShiftRow = useLiveQuery(async () => getOpenShift(userId), [userId]);
  const recentShifts = useLiveQuery(
    () => db.cashierShifts.orderBy('openedAt').reverse().limit(20).toArray(),
    [],
  );

  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    cashSales: number;
    cashExpenses: number;
    expectedCash: number;
    salesTotal: number;
    txCount: number;
  } | null>(null);

  const canOperate = can('create_transaction');

  const loadClosePreview = async () => {
    if (!openShiftRow) return;
    const totals = await computeShiftTotals(new Date(openShiftRow.openedAt));
    setPreview({
      cashSales: totals.cashSales,
      cashExpenses: totals.cashExpenses,
      expectedCash: openShiftRow.openingCash + totals.cashSales - totals.cashExpenses,
      salesTotal: totals.salesTotal,
      txCount: totals.txCount,
    });
    setClosingCash(String(Math.round(openShiftRow.openingCash + totals.cashSales - totals.cashExpenses)));
    setNotes('');
    setCloseDlg(true);
  };

  const handleOpen = async () => {
    if (!canOperate) return;
    setBusy(true);
    try {
      await openShift({
        userId,
        userName,
        openingCash: Number(openingCash) || 0,
      });
      toast.success(t('toast.opened'));
      setOpenDlg(false);
      setOpeningCash('0');
    } catch (err) {
      if (err instanceof Error && err.message === 'SHIFT_ALREADY_OPEN') {
        toast.error(t('toast.alreadyOpen'));
      } else {
        toast.error(t('toast.openFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!openShiftRow?.id || !canOperate) return;
    setBusy(true);
    try {
      const closed = await closeShift({
        shiftId: openShiftRow.id,
        closingCash: Number(closingCash) || 0,
        notes,
      });
      const v = shiftVariance(closed);
      toast.success(
        v != null && Math.abs(v) > 0.5
          ? t('toast.closedWithVariance', { variance: rp(v) })
          : t('toast.closed'),
      );
      setCloseDlg(false);
      setPreview(null);
    } catch {
      toast.error(t('toast.closeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const closedList = useMemo(
    () => (recentShifts ?? []).filter((s) => s.status === 'closed'),
    [recentShifts],
  );

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          {t('title')}
        </h1>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{t('subtitle')}</p>

      {/* Current shift */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          {openShiftRow ? (
            <>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-success/15 text-success flex items-center justify-center shrink-0">
                  <DoorOpen className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-success">{t('status.open')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('openedBy', {
                      name: openShiftRow.userName,
                      time: format(new Date(openShiftRow.openedAt), 'dd MMM yyyy HH:mm', {
                        locale: dateLocale,
                      }),
                    })}
                  </p>
                  <p className="text-xs mt-1">
                    {t('openingCash')}: <span className="font-semibold">{rp(openShiftRow.openingCash)}</span>
                  </p>
                </div>
              </div>
              {canOperate && (
                <Button className="w-full h-10 gap-2" onClick={loadClosePreview}>
                  <DoorClosed className="w-4 h-4" />
                  {t('actions.close')}
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <DoorClosed className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t('status.closed')}</p>
                  <p className="text-xs text-muted-foreground">{t('status.closedHint')}</p>
                  {multiUserEnabled && (
                    <p className="text-[10px] text-muted-foreground mt-1">{t('multiUserHint')}</p>
                  )}
                </div>
              </div>
              {canOperate && (
                <Button className="w-full h-10 gap-2" onClick={() => setOpenDlg(true)}>
                  <DoorOpen className="w-4 h-4" />
                  {t('actions.open')}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('historyTitle')}</h2>
        {closedList.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">{t('historyEmpty')}</p>
        ) : (
          closedList.map((s) => {
            const variance = shiftVariance(s);
            return (
              <Card key={s.id} className="border-0 shadow-sm">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{s.userName}</p>
                    <p className="text-[10px] text-muted-foreground shrink-0">
                      {format(new Date(s.openedAt), 'dd/MM HH:mm', { locale: dateLocale })}
                      {s.closedAt
                        ? ` – ${format(new Date(s.closedAt), 'HH:mm', { locale: dateLocale })}`
                        : ''}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">{t('fields.sales')}</p>
                      <p className="font-semibold">{rp(s.salesTotal)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('fields.txCount')}</p>
                      <p className="font-semibold">{s.txCount}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('fields.expected')}</p>
                      <p className="font-semibold">{rp(s.expectedCash ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('fields.actual')}</p>
                      <p className="font-semibold">{rp(s.closingCash ?? 0)}</p>
                    </div>
                  </div>
                  {variance != null && (
                    <p
                      className={cn(
                        'text-xs font-medium flex items-center gap-1',
                        Math.abs(variance) < 0.5
                          ? 'text-success'
                          : variance > 0
                            ? 'text-primary'
                            : 'text-destructive',
                      )}
                    >
                      {Math.abs(variance) >= 0.5 && <AlertTriangle className="w-3 h-3" />}
                      {t('fields.variance')}: {rp(variance)}
                    </p>
                  )}
                  {s.notes && (
                    <p className="text-[10px] text-muted-foreground">{s.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Open dialog */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent className="max-w-[90vw] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('openDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>{t('openDialog.openingCash')}</Label>
              <Input
                type="number"
                min={0}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="h-11"
              />
              <p className="text-[10px] text-muted-foreground">{t('openDialog.hint')}</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpenDlg(false)}>
              {t('commonCancel')}
            </Button>
            <Button onClick={handleOpen} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('actions.open')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="max-w-[90vw] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('closeDialog.title')}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 py-1">
              <div className="rounded-xl bg-muted/50 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fields.txCount')}</span>
                  <span className="font-semibold">{preview.txCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fields.sales')}</span>
                  <span className="font-semibold">{rp(preview.salesTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fields.cashIn')}</span>
                  <span className="font-semibold text-success">{rp(preview.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fields.cashOut')}</span>
                  <span className="font-semibold text-destructive">-{rp(preview.cashExpenses)}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5">
                  <span className="font-medium">{t('fields.expected')}</span>
                  <span className="font-bold">{rp(preview.expectedCash)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('closeDialog.closingCash')}</Label>
                <Input
                  type="number"
                  min={0}
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('closeDialog.notes')}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder={t('closeDialog.notesPlaceholder')}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCloseDlg(false)}>
              {t('commonCancel')}
            </Button>
            <Button onClick={handleClose} disabled={busy || !preview}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
