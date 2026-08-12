/** Item keranjang checkout batch (Daftar Toko → Detail Pembayaran). */
export interface CheckoutCartItem {
  storeKey: string;
  name: string;
  /** Diisi saat checkout untuk item subscribe (cloud store dibuat di situ). */
  cloudStoreId?: string | null;
  /** subscribe = toko tanpa langganan aktif; renew = perpanjang langganan aktif. */
  action: 'subscribe' | 'renew';
  durationMonths: 1 | 6 | 12;
}
