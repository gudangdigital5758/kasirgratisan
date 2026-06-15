import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Link } from 'react-router-dom';
import {
  Cloud,
  ChevronLeft,
  ChevronRight,
  LogOut,
  CheckCircle2,
  Loader2,
  CreditCard,
  Clock,
  History,
  RefreshCw,
  Store,
  BarChart3,
  MonitorSmartphone,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { GoogleLogin } from '@react-oauth/google';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { isNativePlatform } from '@/lib/printer';
import { nativeGoogleSignIn } from '@/lib/google-auth';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { fetchPlans, checkoutPlan, verifyPayment, fetchStores, uploadBackup, type Plan } from '@/lib/cloud-api';
import { buildBackupJsonString, backupFileName } from '@/lib/backup';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const fmtMb = (mb: number) => `${mb.toFixed(2)} MB`;
const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const INTERVAL_LABEL: Record<string, string> = {
  off: 'Nonaktif',
  hourly: 'Setiap beberapa jam',
  daily: 'Harian',
  weekly: 'Mingguan',
};

export default function CloudBackupSettings() {
  const { can } = useAuth();
  const { isLoggedIn, googleUser, profile, loadingProfile, isSubscribed, isSyncSubscribed, login, logout, refreshProfile } = useCloudAuth();
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  const [plans, setPlans] = useState<Plan[]>([]);
  const [pendingTxId, setPendingTxId] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backupSizeBytes, setBackupSizeBytes] = useState<number | null>(null);
  const [storeCount, setStoreCount] = useState<number | null>(null); // jumlah toko di cloud (null = belum dicek)
  const [showStoragePlans, setShowStoragePlans] = useState(false);
  const [showSyncPlans, setShowSyncPlans] = useState(false);

  const byPrice = (a: Plan, b: Plan) => a.price - b.price;
  const storagePlans = plans.filter((p) => p.category === 'STORAGE').sort(byPrice);
  const syncPlans = plans.filter((p) => p.category === 'SYNC').sort(byPrice);
  const cheapestSyncPrice = syncPlans.length ? syncPlans[0].price : null;

  const loadPlans = useCallback(async () => {
    try {
      setPlans(await fetchPlans());
    } catch {
      /* diabaikan */
    }
  }, []);

  const loadStoreCount = useCallback(async () => {
    try {
      setStoreCount((await fetchStores()).length);
    } catch {
      setStoreCount(null);
    }
  }, []);

  // Plans publik (tanpa auth) — muat selalu agar harga bisa ditampilkan sebagai teaser pra-login.
  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (isLoggedIn) {
      buildBackupJsonString()
        .then((json) => setBackupSizeBytes(new Blob([json]).size))
        .catch(() => setBackupSizeBytes(null));
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn && isSyncSubscribed) loadStoreCount();
  }, [isLoggedIn, isSyncSubscribed, loadStoreCount]);

  if (!can('manage_backup')) {
    return <LockedPage title="Cloud Sync" permissionLabel="Kelola Backup" />;
  }

  const handleNativeLogin = async () => {
    setBusy('login');
    try {
      const idToken = await nativeGoogleSignIn();
      await login(idToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login Google gagal');
    } finally {
      setBusy(null);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setBusy(`checkout:${planId}`);
    try {
      const result = await checkoutPlan(planId, { redirectURL: `${window.location.origin}/settings/cloud-backup` });
      setPaymentLink(result.paymentLink);
      setPendingTxId(result.transaction.id); // memunculkan modal + memulai polling otomatis
      window.open(result.paymentLink, '_blank');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memulai pembayaran');
    } finally {
      setBusy(null);
    }
  };

  // Cek status pembayaran. silent=true untuk polling otomatis (tanpa toast/spinner blocking).
  const checkPayment = useCallback(
    async (silent: boolean) => {
      if (!pendingTxId) return;
      if (!silent) setBusy('verify');
      try {
        const result = await verifyPayment(pendingTxId);
        if (result.transaction.status === 'COMPLETED') {
          await refreshProfile();
          setPendingTxId(null);
          setPaymentLink(null);
          setShowStoragePlans(false);
          setShowSyncPlans(false);
          toast.success('Pembayaran berhasil! Langganan aktif. 🎉');
        } else if (!silent) {
          toast.info('Pembayaran belum terdeteksi. Selesaikan dulu pembayarannya, ya.');
        }
      } catch (err) {
        if (!silent) toast.error(err instanceof Error ? err.message : 'Gagal verifikasi pembayaran');
      } finally {
        if (!silent) setBusy(null);
      }
    },
    [pendingTxId, refreshProfile],
  );

  // Polling otomatis tiap 4 detik selama modal pembayaran terbuka.
  useEffect(() => {
    if (!pendingTxId) return;
    const id = window.setInterval(() => checkPayment(true), 4000);
    return () => window.clearInterval(id);
  }, [pendingTxId, checkPayment]);

  const closePaymentModal = () => {
    setPendingTxId(null);
    setPaymentLink(null);
  };

  const handleSyncNow = async () => {
    const storeId = storeSettings?.cloudStoreId ?? undefined;
    if (!storeId) {
      toast.error('Pilih toko terlebih dahulu di menu Kelola Toko.');
      return;
    }
    setBusy('sync');
    try {
      const json = await buildBackupJsonString();
      await uploadBackup(json, backupFileName(), storeId);
      if (storeSettings?.id) await db.storeSettings.update(storeSettings.id, { lastCloudBackupAt: new Date() });
      await refreshProfile();
      toast.success('Sinkronisasi ke cloud berhasil');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal sinkronisasi ke cloud');
    } finally {
      setBusy(null);
    }
  };

  const usage = profile?.storageUsage;

  const interval = storeSettings?.cloudAutoBackupInterval ?? 'off';
  const intervalSubtitle =
    interval === 'hourly'
      ? `Setiap ${storeSettings?.cloudAutoBackupHours ?? 6} jam`
      : INTERVAL_LABEL[interval] ?? 'Nonaktif';

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Cloud className="w-5 h-5 text-primary" />
          Cloud Sync
        </h1>
      </div>

      {!isLoggedIn ? (
        <div className="space-y-4">
          {/* Hero */}
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mx-auto shadow-lg shadow-primary/25">
                <RefreshCw className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-bold leading-tight">Pantau Toko Real-Time<br />dari Mana Saja</h2>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
                  Data kasir otomatis sinkron ke cloud. Lihat laporan lengkap kapan saja lewat{' '}
                  <span className="font-semibold text-foreground">dashboard.freekasir.com</span> — dari HP atau laptop mana pun.
                </p>
              </div>
              {cheapestSyncPrice != null && (
                <div className="inline-flex items-center gap-1 rounded-full bg-background/80 px-3 py-1 text-[11px] font-medium shadow-sm">
                  <span className="text-muted-foreground">Mulai</span>
                  <span className="text-primary font-bold">{rp(cheapestSyncPrice)}</span>
                  <span className="text-muted-foreground">/bulan</span>
                </div>
              )}
            </div>

            <CardContent className="p-5 space-y-4">
              <ul className="space-y-3">
                <BenefitItem
                  icon={<BarChart3 className="w-4 h-4" />}
                  title="Laporan real-time"
                  desc="Omzet, laba, & stok selalu sinkron dengan transaksi terbaru di kasir."
                />
                <BenefitItem
                  icon={<MonitorSmartphone className="w-4 h-4" />}
                  title="Dashboard web"
                  desc="Buka di dashboard.freekasir.com lewat browser — owner tak perlu pegang HP kasir."
                />
                <BenefitItem
                  icon={<ShieldCheck className="w-4 h-4" />}
                  title="Data aman di cloud"
                  desc="Tersimpan otomatis & tetap utuh walau HP hilang, rusak, atau ganti perangkat."
                />
              </ul>

              <div className="pt-1 space-y-2">
                <p className="text-center text-xs font-medium">Mulai sekarang, login dulu yuk 👇</p>
                <div className="flex justify-center">
                  {isNativePlatform() ? (
                    <Button className="h-11 gap-2 w-full max-w-[260px]" disabled={busy === 'login'} onClick={handleNativeLogin}>
                      {busy === 'login' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                      Lanjut dengan Google
                    </Button>
                  ) : (
                    <GoogleLogin
                      onSuccess={(cr) => {
                        if (cr.credential) login(cr.credential).catch(() => toast.error('Gagal login'));
                        else toast.error('Login Google gagal');
                      }}
                      onError={() => toast.error('Login Google gagal')}
                    />
                  )}
                </div>
                <p className="text-center text-[10px] text-muted-foreground">Aman & cepat — tanpa password baru.</p>
              </div>
            </CardContent>
          </Card>

          <a
            href="https://dashboard.freekasir.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[11px] font-medium text-primary"
          >
            Intip dashboard.freekasir.com →
          </a>
        </div>
      ) : (
        <>
          {/* Account */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              {googleUser?.picture ? (
                <img src={googleUser.picture} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                  {googleUser?.name?.charAt(0) ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{googleUser?.name ?? 'Akun Google'}</p>
                <p className="text-xs text-muted-foreground truncate">{googleUser?.email}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={logout}>
                <LogOut className="w-4 h-4" /> Keluar
              </Button>
            </CardContent>
          </Card>

          {/* Tombol sync cepat — di atas kartu langganan */}
          {isSyncSubscribed && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Button className="w-full h-11 gap-2 font-semibold" disabled={busy === 'sync'} onClick={handleSyncNow}>
                  {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sync Sekarang
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  {storeSettings?.lastCloudBackupAt
                    ? `Terakhir sync: ${new Date(storeSettings.lastCloudBackupAt).toLocaleString('id-ID')}`
                    : 'Belum pernah disinkronkan'}
                </p>
              </CardContent>
            </Card>
          )}

          {loadingProfile && !profile ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/*
                === Cloud Backup (STORAGE) === DINONAKTIFKAN dari tampilan.
                Fokus produk ke Cloud Sync. Fungsi backup (upload JSON) tetap
                dipakai sebagai mesin sync — lihat menu "Backup Otomatis" &
                "Backup Tersimpan" yang kini ke-gate ke isSyncSubscribed.
                Untuk mengaktifkan kembali paket STORAGE, lepas komentar blok ini
                (state showStoragePlans/storagePlans/isSubscribed masih tersedia).

              <SubscriptionSection
                title="Cloud Backup"
                icon={<HardDrive className="w-4 h-4" />}
                description="Backup otomatis data toko ke cloud dalam bentuk file JSON."
                plans={storagePlans}
                subscription={profile?.subscription ?? null}
                isActive={isSubscribed}
                showPlans={showStoragePlans}
                onTogglePlans={() => setShowStoragePlans((v) => !v)}
                busy={busy}
                onSubscribe={handleSubscribe}
                backupSizeBytes={backupSizeBytes}
                storageUsage={usage ?? null}
              />
              */}

              {/* Sorotan manfaat Cloud Sync — hanya saat belum berlangganan */}
              {!isSyncSubscribed && (
                <Card className="border-0 shadow-sm bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-bold flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 text-primary" />
                      Kelola toko dari mana saja
                    </p>
                    <ul className="space-y-2.5">
                      <BenefitItem
                        icon={<BarChart3 className="w-4 h-4" />}
                        title="Laporan real-time"
                        desc="Pantau omzet, laba, & stok toko secara real-time lewat dashboard web — selalu sinkron dengan transaksi terbaru di kasir."
                      />
                      <BenefitItem
                        icon={<MonitorSmartphone className="w-4 h-4" />}
                        title="Dashboard web di mana saja"
                        desc="Buka laporan lengkap lewat browser di dashboard.freekasir.com — owner cukup login dari perangkat sendiri, tanpa pegang HP kasir."
                      />
                      <BenefitItem
                        icon={<ShieldCheck className="w-4 h-4" />}
                        title="Data aman di cloud"
                        desc="Semua data tersimpan otomatis & tetap utuh walau HP hilang, rusak, atau ganti perangkat."
                      />
                    </ul>
                    <a
                      href="https://dashboard.freekasir.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[11px] font-medium text-primary pt-0.5"
                    >
                      Buka dashboard.freekasir.com →
                    </a>
                  </CardContent>
                </Card>
              )}

              {/* === Cloud Sync (SYNC) === */}
              <SubscriptionSection
                title="Cloud Sync"
                icon={<RefreshCw className="w-4 h-4" />}
                description="Pantau laporan penjualan, stok, & keuangan toko dari mana saja — cukup buka di HP atau laptop lain. Semua data tersimpan aman di cloud, tetap utuh walau perangkat hilang, rusak, atau ganti HP."
                plans={syncPlans}
                subscription={profile?.syncSubscription ?? null}
                isActive={isSyncSubscribed}
                showPlans={showSyncPlans}
                onTogglePlans={() => setShowSyncPlans((v) => !v)}
                busy={busy}
                onSubscribe={handleSubscribe}
                backupSizeBytes={null}
                storageUsage={null}
              />

              {/* Belum ada toko di cloud sama sekali — sync tidak bisa jalan. Alert merah tegas. */}
              {isSyncSubscribed && storeCount === 0 && (
                <Card className="border-0 shadow-sm bg-destructive/10 ring-1 ring-destructive/30">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-destructive">Belum ada toko di cloud</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        Langganan aktif, tapi data <span className="font-medium">belum tersinkron</span> karena belum ada toko. Buat toko dulu agar laporan muncul di dashboard.
                      </p>
                      <Link to="/settings/cloud-backup/stores" className="inline-block mt-2">
                        <Button size="sm" variant="destructive" className="h-8 text-xs gap-1">
                          <Store className="w-3.5 h-3.5" /> Buat Toko Sekarang
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Toko sudah ada, tapi device ini belum dipilih/dihubungkan. Peringatan kuning. */}
              {isSyncSubscribed && storeCount !== 0 && storeCount !== null && !storeSettings?.cloudStoreId && (
                <Card className="border-0 shadow-sm border-l-4 border-l-warning">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Store className="w-4 h-4 text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">Device belum terhubung ke toko</p>
                      <p className="text-[10px] text-muted-foreground">Pilih toko agar data bisa disinkronkan ke cloud.</p>
                    </div>
                    <Link to="/settings/cloud-backup/stores">
                      <Button size="sm" variant="outline" className="h-7 text-xs">Pilih</Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Menu cards */}
          <div className="space-y-4">
            {isSyncSubscribed && (
              <>
                <ExternalMenuCard
                  href="https://dashboard.freekasir.com"
                  icon={<BarChart3 className="w-4 h-4" />}
                  title="Buka Dashboard Web"
                  subtitle="Lihat laporan di dashboard.freekasir.com"
                />
                <MenuCard
                  to="/settings/cloud-backup/stores"
                  icon={<Store className="w-4 h-4" />}
                  title="Kelola Toko"
                  subtitle="Pilih atau buat toko untuk sync"
                />
                <MenuCard
                  to="/settings/cloud-backup/auto"
                  icon={<Clock className="w-4 h-4" />}
                  title="Sinkronisasi Otomatis"
                  subtitle={intervalSubtitle}
                />
              </>
            )}
            <MenuCard
              to="/settings/cloud-backup/history"
              icon={<History className="w-4 h-4" />}
              title="Riwayat Transaksi"
              subtitle="Lihat pembelian & cek status pembayaran"
            />
          </div>
        </>
      )}

      {/* Modal menunggu pembayaran — polling status otomatis */}
      <Dialog open={!!pendingTxId} onOpenChange={(o) => !o && closePaymentModal()}>
        <DialogContent className="max-w-[88vw] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">Menunggu Pembayaran</DialogTitle>
            <DialogDescription className="text-center">
              Selesaikan pembayaran di halaman yang terbuka. Status langganan akan aktif otomatis setelah pembayaran kami terima.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-2">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-7 h-7 text-primary" />
              </div>
              <Loader2 className="w-16 h-16 absolute inset-0 text-primary animate-spin" style={{ animationDuration: '1.5s' }} />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Memeriksa status pembayaran otomatis setiap beberapa detik…
            </p>
          </div>

          <div className="space-y-2">
            <Button className="w-full h-10 gap-2" disabled={busy === 'verify'} onClick={() => checkPayment(false)}>
              {busy === 'verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Saya sudah bayar — Cek sekarang
            </Button>
            {paymentLink && (
              <Button
                variant="outline"
                className="w-full h-10 gap-2"
                onClick={() => window.open(paymentLink, '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
                Buka halaman pembayaran
              </Button>
            )}
            <Button variant="ghost" className="w-full h-9 text-muted-foreground" onClick={closePaymentModal}>
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Reusable subscription section for STORAGE / SYNC ---

interface SubscriptionSectionProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  plans: Plan[];
  subscription: import('@/lib/cloud-api').Subscription | null;
  isActive: boolean;
  showPlans: boolean;
  onTogglePlans: () => void;
  busy: string | null;
  onSubscribe: (planId: string) => void;
  backupSizeBytes: number | null;
  storageUsage: import('@/lib/cloud-api').StorageUsage | null;
}

function SubscriptionSection({
  title, icon, description, plans, subscription, isActive,
  showPlans, onTogglePlans, busy, onSubscribe, backupSizeBytes, storageUsage,
}: SubscriptionSectionProps) {
  const currentPlanId = subscription?.planId;
  const usage = storageUsage;
  const usagePct = usage && usage.limitMb > 0 ? Math.min(100, (usage.usedMb / usage.limitMb) * 100) : 0;
  const isStorage = !!usage;

  const buttonLabel = (planId: string) =>
    !isActive ? 'Langganan' : planId === currentPlanId ? 'Perpanjang' : 'Pilih';

  const plansList = (
    <div className="space-y-2">
      {plans.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">Memuat paket…</p>
      ) : (
        plans.map((plan) => {
          const est = isStorage && backupSizeBytes
            ? Math.max(1, Math.floor((plan.storageLimitMb * 1024 * 1024) / backupSizeBytes))
            : null;
          const isCurrent = isActive && plan.id === currentPlanId;
          const storeLimit = plan.maxStores;
          return (
            <div key={plan.id} className={`flex items-center justify-between rounded-xl border p-3 ${isCurrent ? 'border-primary/40 bg-primary/5' : ''}`}>
              <div>
                <p className="text-sm font-semibold">
                  {plan.name}
                  {isCurrent && <span className="ml-1.5 text-[10px] font-medium text-primary">(paket aktif)</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {rp(plan.price)} / bulan
                  {isStorage && <> · {plan.storageLimitMb} MB</>}
                  {!isStorage && storeLimit != null && (
                    <> · {storeLimit >= 999999 ? 'Unlimited' : storeLimit} toko</>
                  )}
                </p>
                {est != null && (
                  <p className="text-[11px] text-success font-medium mt-0.5">≈ {est.toLocaleString('id-ID')} file backup</p>
                )}
              </div>
              <Button
                size="sm"
                variant={isActive && !isCurrent ? 'outline' : 'default'}
                className="h-8"
                disabled={busy === `checkout:${plan.id}`}
                onClick={() => onSubscribe(plan.id)}
              >
                {busy === `checkout:${plan.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : buttonLabel(plan.id)}
              </Button>
            </div>
          );
        })
      )}
      {isStorage && backupSizeBytes != null && (
        <p className="text-[10px] text-muted-foreground">
          *Estimasi berdasarkan ukuran data saat ini ({fmtSize(backupSizeBytes)}).
        </p>
      )}
    </div>
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <p className="text-sm font-semibold">{title}</p>
        </div>

        {isActive && subscription ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span className="text-xs font-semibold">{subscription.plan.name}</span>
              </div>
              {subscription.endDate && (
                <span className="text-[10px] text-muted-foreground">
                  s/d {format(new Date(subscription.endDate), 'dd MMM yyyy')}
                </span>
              )}
            </div>
            {usage && (
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>{fmtMb(usage.usedMb)} terpakai</span>
                  <span>dari {fmtMb(usage.limitMb)}</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${usagePct}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-9"
                disabled={!currentPlanId || busy === `checkout:${currentPlanId}`}
                onClick={() => currentPlanId && onSubscribe(currentPlanId)}
              >
                {busy === `checkout:${currentPlanId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Perpanjang'}
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-9" onClick={onTogglePlans}>
                {showPlans ? 'Tutup' : 'Ubah Paket'}
              </Button>
            </div>
            {showPlans && (
              <div className="pt-1 space-y-3 border-t">
                <p className="text-xs text-muted-foreground pt-2">
                  Pilih paket sama untuk memperpanjang, atau paket lain untuk ganti.
                </p>
                {plansList}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{description}</p>
            {plansList}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Benefit item (marketing highlight) ---

function BenefitItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
      </div>
    </li>
  );
}

// --- Menu card ---

function MenuCard({ to, icon, title, subtitle }: { to: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link to={to} className="block">
      <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function ExternalMenuCard({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block">
      <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </a>
  );
}
