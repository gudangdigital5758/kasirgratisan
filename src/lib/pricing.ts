/**
 * Simple pricing / margin helpers for product HPP (no AI).
 */

export function calcMarginPercent(price: number, hpp: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(hpp) || hpp < 0) return null;
  return ((price - hpp) / price) * 100;
}

export function calcProfitPerUnit(price: number, hpp: number): number {
  return (Number(price) || 0) - (Number(hpp) || 0);
}

/** Target margin % → suggested sell price from HPP. margin e.g. 30 = 30%. */
export function priceFromMargin(hpp: number, marginPercent: number): number | null {
  if (!Number.isFinite(hpp) || hpp < 0) return null;
  if (!Number.isFinite(marginPercent) || marginPercent >= 100 || marginPercent < 0) return null;
  return hpp / (1 - marginPercent / 100);
}

export function marginTone(marginPercent: number | null): 'danger' | 'warn' | 'ok' | 'neutral' {
  if (marginPercent == null) return 'neutral';
  if (marginPercent < 0) return 'danger';
  if (marginPercent < 15) return 'warn';
  return 'ok';
}
