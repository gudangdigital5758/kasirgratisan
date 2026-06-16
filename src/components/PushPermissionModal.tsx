import { useEffect, useState } from 'react';
import { Bell, CloudUpload, CreditCard, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { isPushSupported, getPermissionState, requestPushPermission } from '@/lib/onesignal';
import { useTranslation } from 'react-i18next';

const ASKED_KEY = 'freekasir_push_asked_v1';

export default function PushPermissionModal() {
  const { t } = useTranslation('settings');
  const { isLoggedIn } = useCloudAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (!isPushSupported()) return;
    if (getPermissionState() !== 'default') return;
    if (localStorage.getItem(ASKED_KEY)) return;
    const timer = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(timer);
  }, [isLoggedIn]);

  const dismiss = () => {
    localStorage.setItem(ASKED_KEY, '1');
    setOpen(false);
  };

  const enable = () => {
    localStorage.setItem(ASKED_KEY, '1');
    requestPushPermission();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={dismiss}>
      <div
        className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Bell className="w-7 h-7" />
          </div>
          <h2 className="text-base font-bold">{t('pushPermission.title')}</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('pushPermission.description')}
          </p>
        </div>

        <div className="space-y-2.5">
          <Benefit icon={<CloudUpload className="w-4 h-4" />} text={t('pushPermission.benefits.cloudBackup')} />
          <Benefit icon={<CreditCard className="w-4 h-4" />} text={t('pushPermission.benefits.payment')} />
          <Benefit icon={<Megaphone className="w-4 h-4" />} text={t('pushPermission.benefits.announcement')} />
        </div>

        <div className="space-y-2 pt-1">
          <Button className="w-full h-11 font-semibold gap-2" onClick={enable}>
            <Bell className="w-4 h-4" /> {t('pushPermission.enable')}
          </Button>
          <Button variant="ghost" className="w-full h-9 text-sm text-muted-foreground" onClick={dismiss}>
            {t('pushPermission.later')}
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          {t('pushPermission.hint')}
        </p>
      </div>
    </div>
  );
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <p className="text-xs text-foreground/90 leading-snug pt-1">{text}</p>
    </div>
  );
}
