import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Send, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { APP_VERSION } from '@/lib/app-version';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function IssueReport() {
  const { t } = useTranslation('settings');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const getDeviceInfo = () => {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
      url: window.location.href,
      time: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appVersion: APP_VERSION,
    };
  };

  const handleSend = async () => {
    if (!description.trim()) {
      toast.error(t('issueReport.emptyError'));
      return;
    }
    setShowConfirm(true);
  };

  const submitReport = async () => {
    setBusy(true);
    try {
      const response = await fetch('https://external-api.freekasir.com/webhook/issue-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error_log: description.trim(),
          device_info: getDeviceInfo(),
        }),
      });

      if (response.ok) {
        toast.success(t('issueReport.success'));
        setDescription('');
        setShowConfirm(false);
      } else {
        toast.error(t('issueReport.failed'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('issueReport.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-6 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Send className="w-5 h-5 text-primary" />
          {t('issueReport.title')}
        </h1>
      </div>

      {/* Editor Card */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="issue-description-input" className="text-sm font-semibold">
              {t('issueReport.descriptionLabel')}
            </Label>
            <Textarea
              id="issue-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('issueReport.placeholder')}
              className="min-h-[150px] text-sm leading-relaxed"
              maxLength={2000}
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 flex gap-2 items-start text-[11px] text-muted-foreground leading-normal">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              {t('issueReport.disclaimer')}
            </p>
          </div>

          <Button className="w-full h-11 gap-2" onClick={handleSend} disabled={busy}>
            <Send className="w-4 h-4" />
            {t('issueReport.submit')}
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl bg-background border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('issueReport.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm whitespace-pre-line">
              {t('issueReport.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 mt-4">
            <AlertDialogCancel disabled={busy} className="mt-0">{t('issueReport.cancel')}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                submitReport();
              }}
              disabled={busy}
            >
              {busy ? t('issueReport.sending') : t('issueReport.agreeAndSend')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
