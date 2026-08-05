import { describe, expect, it } from 'vitest';
import {
  clampDiscountValue,
  lineDiscountAmount,
  lineProfit,
  lineSubtotal,
  transactionDiscountAmount,
} from '@/lib/cart-math';

describe('cart math — lineDiscountAmount', () => {
  it('no discount → 0', () => {
    expect(lineDiscountAmount({ price: 10000, qty: 2, discountType: null, discountValue: 0 })).toBe(0);
  });

  it('percentage discount (unrounded, matches cashier behavior)', () => {
    expect(
      lineDiscountAmount({ price: 10000, qty: 2, discountType: 'percentage', discountValue: 10 }),
    ).toBe(2000);
    // nilai tidak dibulatkan agar identik dengan perilaku lama
    expect(
      lineDiscountAmount({ price: 3333, qty: 3, discountType: 'percentage', discountValue: 10 }),
    ).toBeCloseTo(999.9, 5);
  });

  it('clamps percentage to 0..100', () => {
    expect(
      lineDiscountAmount({ price: 10000, qty: 1, discountType: 'percentage', discountValue: 150 }),
    ).toBe(10000);
    expect(
      lineDiscountAmount({ price: 10000, qty: 1, discountType: 'percentage', discountValue: -5 }),
    ).toBe(0);
  });

  it('nominal discount clamped to line base', () => {
    expect(
      lineDiscountAmount({ price: 10000, qty: 2, discountType: 'nominal', discountValue: 5000 }),
    ).toBe(5000);
    expect(
      lineDiscountAmount({ price: 10000, qty: 2, discountType: 'nominal', discountValue: 99999 }),
    ).toBe(20000);
  });
});

describe('cart math — lineSubtotal', () => {
  it('base minus discount, never negative', () => {
    expect(lineSubtotal({ price: 10000, qty: 2, discountType: 'percentage', discountValue: 10 })).toBe(18000);
    expect(
      lineSubtotal({ price: 5000, qty: 1, discountType: 'nominal', discountValue: 99999 }),
    ).toBe(0);
  });
});

describe('cart math — transactionDiscountAmount', () => {
  it('percentage on subtotal (unrounded)', () => {
    expect(transactionDiscountAmount(100000, 'percentage', 10)).toBe(10000);
    expect(transactionDiscountAmount(99999, 'percentage', 10)).toBeCloseTo(9999.9, 5);
  });

  it('nominal clamped to subtotal', () => {
    expect(transactionDiscountAmount(100000, 'nominal', 15000)).toBe(15000);
    expect(transactionDiscountAmount(100000, 'nominal', 999999)).toBe(100000);
  });

  it('no type → 0; negative value → 0', () => {
    expect(transactionDiscountAmount(100000, null, 5000)).toBe(0);
    expect(transactionDiscountAmount(100000, 'percentage', -10)).toBe(0);
  });
});

describe('cart math — lineProfit', () => {
  it('(price - hpp) * qty', () => {
    expect(lineProfit({ price: 15000, hpp: 10000, qty: 3 })).toBe(15000);
  });
});

describe('cart math — clampDiscountValue', () => {
  it('percentage clamped 0..100; nominal >= 0', () => {
    expect(clampDiscountValue('percentage', 150)).toBe(100);
    expect(clampDiscountValue('percentage', -3)).toBe(0);
    expect(clampDiscountValue('nominal', 5000)).toBe(5000);
    expect(clampDiscountValue('nominal', -5)).toBe(0);
    expect(clampDiscountValue(null, 100)).toBe(100);
  });
});
