import { Lock, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useNavigate } from 'react-router-dom';

interface LockedPageProps {
  /**
   * Title shown at the top of the locked card. Should describe the area the
   * user tried to access (e.g. "Kasir", "Laporan").
   */
  title: string;
  /**
   * Optional friendly note about what permission is needed. If omitted we
   * show a generic message.
   */
  permissionLabel?: string;
}

/**
 * Friendly "you don't have access to this page" placeholder.
 *
 * Used in place of auto-redirecting away, so the bottom nav stays intact and
 * users understand WHY a tab is empty for them. Owner sees a hint to contact
 * themselves (i.e. it should never trigger), staff sees instruction to ask
 * the owner.
 */
export default function LockedPage({ title, permissionLabel }: LockedPageProps) {
  const { isOwner } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Lock className="w-5 h-5 text-muted-foreground" />
        {title}
      </h1>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-warning/10 text-warning flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold">Akses dikunci</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              {isOwner ? (
                <>
                  Akun Anda seharusnya memiliki akses penuh. Coba refresh aplikasi atau periksa pengaturan akun.
                </>
              ) : (
                <>
                  Anda tidak punya izin untuk membuka halaman <span className="font-medium">{title}</span>
                  {permissionLabel && (
                    <>
                      {' '}(<span className="italic">{permissionLabel}</span>)
                    </>
                  )}
                  . Hubungi pemilik toko jika menurut Anda ini tidak benar.
                </>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => navigate('/')}>
            Kembali ke Beranda
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
