import { Wallet, AlertTriangle, Infinity as InfinityIcon, Users as UsersIcon, FileSpreadsheet, PackageSearch, Sparkles, Cloud, type LucideIcon } from 'lucide-react';
import { db } from './db';

/**
 * Static catalog of "What's New" announcements.
 *
 * IMPORTANT:
 *  - Each `id` MUST be unique and MUST NEVER change once shipped — once a user
 *    dismisses an entry, that id is recorded in their storeSettings. Renaming
 *    the id will cause the entry to reappear.
 *  - Order this array newest-first so the modal slideshow starts with the
 *    most recent entry.
 *  - Date prefix in `id` (YYYY-MM-...) keeps things human-sortable in the DB.
 */

export interface WhatsNewFeature {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind class pair, e.g. "text-warning bg-warning/10" */
  iconColor: string;
  publishedAt: string; // ISO date (YYYY-MM-DD), display only
  cta?: {
    label: string;
    to: string; // internal route
  };
}

export const FEATURES: WhatsNewFeature[] = [
  {
    id: '2026-06-cloud-backup',
    title: 'Backup Otomatis ke Cloud',
    description:
      'Data toko kini bisa dibackup otomatis ke cloud yang aman — tetap aman walau HP hilang, rusak, atau ganti perangkat. Login dengan akun Google, pilih paket langganan, lalu atur jadwal backup otomatis. Kamu juga bisa restore data langsung dari cloud kapan saja.',
    icon: Cloud,
    iconColor: 'text-primary bg-primary/10',
    publishedAt: '2026-06-11',
    cta: { label: 'Aktifkan Cloud Backup', to: '/settings/cloud-backup' },
  },
  {
    id: '2026-06-rebrand-freekasir',
    title: 'Wajah Baru: FreeKasir',
    description:
      'Aplikasi ini kini bernama FreeKasir dengan tampilan dan warna baru yang lebih segar. Fungsi & data kamu tetap sama, tidak ada yang berubah. Suka warna lain? Kamu tetap bisa pilih tema favoritmu di Pengaturan → Warna Tema.',
    icon: Sparkles,
    iconColor: 'text-primary bg-primary/10',
    publishedAt: '2026-06-11',
    cta: { label: 'Ganti Warna Tema', to: '/settings/theme' },
  },
  {
    id: '2026-06-stock-search-scan',
    title: 'Cari & Scan Produk di Stock In/Out',
    description:
      'Input stok kini lebih cepat. Di halaman Stock In dan Stock Out, pilih produk lewat pencarian berdasarkan nama, SKU, atau barcode — lengkap dengan opsi scan kamera seperti di kasir. Kolom Jumlah dan Harga Beli juga otomatis diformat ribuan (10.000) agar mudah dibaca.',
    icon: PackageSearch,
    iconColor: 'text-success bg-success/10',
    publishedAt: '2026-06-10',
    cta: { label: 'Buka Stock In', to: '/stock-in' },
  },
  {
    id: '2026-06-export-excel',
    title: 'Export Laporan ke Excel',
    description:
      'Kamu bisa export laporan ke file Excel (.xlsx) langsung dari halaman Laporan. Klik tombol Export, pilih rentang tanggal, dan dapatkan file berisi ringkasan laba-rugi, daftar transaksi, detail item terjual, dan pengeluaran — siap diolah atau diarsipkan.',
    icon: FileSpreadsheet,
    iconColor: 'text-success bg-success/10',
    publishedAt: '2026-06-09',
    cta: { label: 'Buka Laporan', to: '/reports' },
  },
  {
    id: '2026-05-customers',
    title: 'Data Pelanggan',
    description:
      'Kelola data pelanggan dan hubungkan ke transaksi. Di kasir kamu bisa cari, pilih, atau buat pelanggan baru langsung saat jualan (tetap opsional). Buka detail pelanggan untuk lihat riwayat transaksinya.',
    icon: UsersIcon,
    iconColor: 'text-primary bg-primary/10',
    publishedAt: '2026-05-30',
    cta: { label: 'Kelola Pelanggan', to: '/customers' },
  },
  {
    id: '2026-05-unmanaged-stock',
    title: 'Produk Tanpa Stok',
    description:
      'Sekarang kamu bisa menjual produk tanpa mengelola stok, cocok untuk jasa atau makanan yang dibuat dadakan. Aktifkan lewat tombol "Kelola Stok" saat menambah/mengedit produk. Produk ini akan selalu tersedia di kasir.',
    icon: InfinityIcon,
    iconColor: 'text-primary bg-primary/10',
    publishedAt: '2026-05-29',
    cta: { label: 'Atur Produk', to: '/products' },
  },
  {
    id: '2026-05-expense-tracking',
    title: 'Pencatatan Pengeluaran',
    description:
      'Catat biaya operasional toko (listrik, gaji, sewa, dll) dan lihat laba bersih sesungguhnya di laporan. Cashflow toko jadi lengkap dalam satu app.',
    icon: Wallet,
    iconColor: 'text-warning bg-warning/10',
    publishedAt: '2026-05-25',
    cta: { label: 'Coba Sekarang', to: '/expenses' },
  },
  {
    id: '2026-05-error-boundary',
    title: 'Pesan Error yang Lebih Jelas',
    description:
      'Kalau aplikasi mengalami error, sekarang muncul pesan dan detail yang bisa kamu salin untuk dilaporkan ke developer. Tidak ada lagi blank screen tanpa info.',
    icon: AlertTriangle,
    iconColor: 'text-destructive bg-destructive/10',
    publishedAt: '2026-05-24',
  },
];

/** All feature ids currently shipped — useful for "mark all seen" flows. */
export const ALL_FEATURE_IDS: string[] = FEATURES.map((f) => f.id);

/** Returns the FEATURES the user has not dismissed yet, ordered newest-first. */
export function getUnseenFeatures(seenIds: string[] | undefined): WhatsNewFeature[] {
  const seen = new Set(seenIds ?? []);
  return FEATURES.filter((f) => !seen.has(f.id));
}

/** Persist all current ids as seen. Idempotent. */
export async function markAllFeaturesSeen(): Promise<void> {
  const settings = await db.storeSettings.toCollection().first();
  if (!settings?.id) return;
  const seen = new Set(settings.seenWhatsNewIds ?? []);
  for (const id of ALL_FEATURE_IDS) seen.add(id);
  await db.storeSettings.update(settings.id, { seenWhatsNewIds: Array.from(seen) });
}

/** Persist specific ids as seen. Used after the modal is dismissed. */
export async function markFeaturesSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const settings = await db.storeSettings.toCollection().first();
  if (!settings?.id) return;
  const seen = new Set(settings.seenWhatsNewIds ?? []);
  for (const id of ids) seen.add(id);
  await db.storeSettings.update(settings.id, { seenWhatsNewIds: Array.from(seen) });
}
