import { describe, expect, it } from 'vitest';
import { calcMarginPercent, marginTone, priceFromMargin, calcProfitPerUnit } from '@/lib/pricing';

describe('pricing helpers', () => {
  it('calculates margin percent', () => {
    expect(calcMarginPercent(10000, 7000)).toBeCloseTo(30, 5);
    expect(calcMarginPercent(0, 1000)).toBeNull();
    expect(calcMarginPercent(10000, 12000)).toBeCloseTo(-20, 5);
  });

  it('suggests price from target margin', () => {
    const price = priceFromMargin(7000, 30);
    expect(price).not.toBeNull();
    expect(price!).toBeCloseTo(10000, 0);
    expect(priceFromMargin(7000, 100)).toBeNull();
    expect(priceFromMargin(7000, -1)).toBeNull();
  });

  it('profit per unit', () => {
    expect(calcProfitPerUnit(15000, 10000)).toBe(5000);
  });

  it('margin tone bands', () => {
    expect(marginTone(null)).toBe('neutral');
    expect(marginTone(-5)).toBe('danger');
    expect(marginTone(10)).toBe('warn');
    expect(marginTone(25)).toBe('ok');
  });
});
