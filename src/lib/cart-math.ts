/**
 * Matematika keranjang kasir — logika murni (tanpa UI/DB) yang diekstrak dari
 * Cashier.tsx agar bisa diuji dan dipakai ulang.
 */

export type DiscountType = 'percentage' | 'nominal' | null;

export interface CartLineInput {
  price: number;
  qty: number;
  discountType: DiscountType;
  discountValue: number;
}

export interface CartLineProfitInput {
  price: number;
  hpp: number;
  qty: number;
}

/** Diskon per baris (dibatasi: tidak lebih dari subtotal baris). */
export function lineDiscountAmount(line: CartLineInput): number {
  const base = line.price * line.qty;
  if (line.discountType === 'percentage') {
    const pct = Math.min(100, Math.max(0, line.discountValue));
    return (base * pct) / 100;
  }
  if (line.discountType === 'nominal') {
    return Math.min(base, Math.max(0, line.discountValue));
  }
  return 0;
}

/** Subtotal per baris setelah diskon (tidak pernah negatif). */
export function lineSubtotal(line: CartLineInput): number {
  const base = line.price * line.qty;
  return Math.max(0, base - lineDiscountAmount(line));
}

/** Estimasi profit per baris (harga jual - HPP) × qty, sebelum diskon transaksi. */
export function lineProfit(line: CartLineProfitInput): number {
  return (line.price - line.hpp) * line.qty;
}

/** Diskon tingkat transaksi berdasarkan subtotal (dibatasi 0..subtotal). */
export function transactionDiscountAmount(
  subtotal: number,
  type: DiscountType,
  value: number,
): number {
  if (type === 'percentage') {
    return (subtotal * Math.min(100, Math.max(0, value))) / 100;
  }
  if (type === 'nominal') {
    return Math.min(subtotal, Math.max(0, value));
  }
  return 0;
}

/** Batasi nilai diskon sesuai tipe (persen 0..100, nominal >= 0). */
export function clampDiscountValue(type: DiscountType, value: number): number {
  if (type === 'percentage') return Math.min(100, Math.max(0, value));
  return Math.max(0, value);
}
