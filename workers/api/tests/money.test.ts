import { describe, expect, it } from 'vitest';
import { toRupiah } from '../src/lib/money';

describe('toRupiah (audit HPP desimal)', () => {
  it('format Indonesia: titik ribuan + koma desimal', () => {
    expect(toRupiah('10.333,567')).toBe(10334); // half-up
    expect(toRupiah('10.333,4')).toBe(10333);   // half-down
    expect(toRupiah('10.333,5')).toBe(10334);
    expect(toRupiah('1.234.567')).toBe(1234567);
    expect(toRupiah('0,5')).toBe(1);
  });

  it('titik ribuan murni vs desimal internasional', () => {
    expect(toRupiah('10.333.567')).toBe(10333567); // grup 3-3 -> ribuan, BUKAN pecahan
    expect(toRupiah('10.333')).toBe(10333);        // satu titik tanpa koma -> internasional
    expect(toRupiah('10.5')).toBe(11);             // 10.5 half-up -> 11
    expect(toRupiah('10333.567')).toBe(10334);
  });

  it('number: dibulatkan half-up ke integer', () => {
    expect(toRupiah(10333.567)).toBe(10334);
    expect(toRupiah(0.5)).toBe(1);
    expect(toRupiah(2.675)).toBe(3); // epsilon guard utk noise float
    expect(toRupiah(5000)).toBe(5000);
  });

  it('menolak invalid', () => {
    expect(toRupiah(null)).toBeNull();
    expect(toRupiah(undefined)).toBeNull();
    expect(toRupiah('abc')).toBeNull();
    expect(toRupiah('')).toBeNull();
    expect(toRupiah(' ')).toBeNull();
    expect(toRupiah(-1)).toBeNull();
    expect(toRupiah(-1000.5)).toBeNull();
    expect(toRupiah(NaN)).toBeNull();
    expect(toRupiah(Infinity)).toBeNull();
    expect(toRupiah('12,3,4')).toBeNull();     // dua koma
    expect(toRupiah('1.23.456')).toBeNull();   // grup tidak 3 digit
    expect(toRupiah('10.333,abc')).toBeNull(); // sampah setelah koma
    expect(toRupiah(true)).toBeNull();
    expect(toRupiah({})).toBeNull();
  });
});
