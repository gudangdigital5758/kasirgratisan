/**
 * Identitas produk Profitku — single source of truth untuk domain & package.
 * Internal storage keys / IndexedDB name sengaja tidak diubah agar data lokal
 * existing user tidak hilang.
 */

export const BRAND = {
  name: 'Profitku',
  tagline: 'POS Gratis — Kelola Jualan Jadi Mudah',
  domain: 'profitku.my.id',
  origin: 'https://profitku.my.id',
  /** API edge (Cloudflare Worker) */
  apiOrigin: 'https://api.profitku.my.id',
  /** Dashboard web (opsional, fase berikutnya) */
  dashboardOrigin: 'https://dashboard.profitku.my.id',
  /** Katalog toko online (opsional) */
  marketOrigin: 'https://market.profitku.my.id',
  /** Android / Capacitor applicationId (siap, listing Play ditunda) */
  appId: 'com.profitku.app',
  /** Watermark struk */
  watermarkHost: 'Profitku.my.id',
  supportEmail: 'support@profitku.my.id',
  /** Link komunitas — ganti saat channel resmi live */
  telegramUrl: 'https://t.me/profitku',
  whatsappChannelUrl: 'https://s.id/waprofitku',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=com.profitku.app',
  /**
   * Listing Google Play ditunda — fokus PWA (profitku.my.id).
   * Set true saat siap publish; UI alert/billing Play ikut ikut flag ini.
   */
  playStoreEnabled: false,
  /** Paket tunggal langganan cloud */
  cloudPlanId: 'cloud_monthly',
  cloudPriceIdr: 25_000,
  cloudStorageMb: 2048,
  cloudMaxStores: 1,
} as const;

export type Brand = typeof BRAND;
