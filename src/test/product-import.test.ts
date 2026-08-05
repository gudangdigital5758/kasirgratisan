import { describe, expect, it } from 'vitest';
import { cleanNumber, parseTrackStock, validateImportRow } from '@/lib/product-import';
import type { ImportValidationContext } from '@/lib/product-import';

const t = (key: string) => key;

function makeCtx(overrides: Partial<ImportValidationContext> = {}): ImportValidationContext {
  return {
    // dbSkus/dbProductsBySku selalu lowercase (komponen menormalisasi sebelum validasi)
    categories: [{ id: 1, name: 'Minuman', color: '#000', icon: '', createdAt: new Date(), isDeleted: 0, deletedAt: null }],
    units: [{ id: 1, name: 'pcs', isDefault: 1, createdAt: new Date(), isDeleted: 0, deletedAt: null }],
    dbSkus: new Set(['p001']),
    dbProductsBySku: new Map([['p001', 'Es Teh']]),
    skuInFile: new Set(),
    t,
    ...overrides,
  };
}

describe('product import — cleanNumber', () => {
  it('parses plain numbers', () => {
    expect(cleanNumber('10000')).toBe(10000);
    expect(cleanNumber('')).toBe(0);
  });

  it('handles Rp, spaces and mixed separators', () => {
    expect(cleanNumber('Rp 10.000')).toBe(10000);
    expect(cleanNumber('10,000')).toBe(10000);
    expect(cleanNumber('1.234,56')).toBeCloseTo(1234.56, 2);
    expect(cleanNumber('1,234.56')).toBeCloseTo(1234.56, 2);
    expect(cleanNumber('1.234.567')).toBe(1234567);
    expect(cleanNumber('1.234.567,89')).toBeCloseTo(1234567.89, 2);
    expect(cleanNumber('12.5')).toBeCloseTo(12.5, 2);
    expect(cleanNumber('12,50')).toBeCloseTo(12.5, 2);
    expect(cleanNumber('1.234')).toBe(1234);
    expect(cleanNumber('  Rp 15.000  ')).toBe(15000);
  });

  it('plain integers parse directly', () => {
    expect(cleanNumber('10000')).toBe(10000);
    expect(cleanNumber('0')).toBe(0);
    expect(cleanNumber('-2')).toBe(-2);
  });

  it('returns -1 for unparsable', () => {
    expect(cleanNumber('abc')).toBe(-1);
  });
});

describe('product import — parseTrackStock', () => {
  it('default true', () => {
    expect(parseTrackStock('')).toBe(true);
    expect(parseTrackStock('ya')).toBe(true);
  });

  it('false for negative keywords', () => {
    expect(parseTrackStock('tidak')).toBe(false);
    expect(parseTrackStock('TIDAK')).toBe(false);
    expect(parseTrackStock('no')).toBe(false);
    expect(parseTrackStock('false')).toBe(false);
    expect(parseTrackStock('0')).toBe(false);
    expect(parseTrackStock('salah')).toBe(false);
  });
});

describe('product import — validateImportRow', () => {
  it('valid row → isValid true, no errors', () => {
    const row = validateImportRow(
      {
        rowNum: 2,
        name: 'Kopi Susu',
        sku: 'P100',
        categoryName: 'Minuman',
        priceStr: '15000',
        hppStr: '8000',
        stockStr: '10',
        trackStockStr: '',
        unit: 'pcs',
      },
      makeCtx(),
    );
    expect(row.isValid).toBe(true);
    expect(row.errors).toHaveLength(0);
    expect(row.price).toBe(15000);
    expect(row.trackStock).toBe(true);
  });

  it('flags duplicate SKU within file', () => {
    const ctx = makeCtx();
    validateImportRow(
      { rowNum: 2, name: 'A', sku: 'DUP', categoryName: 'Minuman', priceStr: '1', hppStr: '', stockStr: '', trackStockStr: '', unit: 'pcs' },
      ctx,
    );
    const second = validateImportRow(
      { rowNum: 3, name: 'B', sku: 'dup', categoryName: 'Minuman', priceStr: '1', hppStr: '', stockStr: '', trackStockStr: '', unit: 'pcs' },
      ctx,
    );
    expect(second.isValid).toBe(false);
    expect(second.errors).toContain('excel.errorSkuDupExcel');
  });

  it('flags SKU already in DB with product name', () => {
    const row = validateImportRow(
      { rowNum: 2, name: 'X', sku: 'P001', categoryName: 'Minuman', priceStr: '1', hppStr: '', stockStr: '', trackStockStr: '', unit: 'pcs' },
      makeCtx(),
    );
    expect(row.isValid).toBe(false);
    expect(row.errors.some((e) => e.includes('excel.errorSkuDupDb') && e.includes('Es Teh'))).toBe(true);
  });

  it('flags missing/unknown category and unit', () => {
    const row = validateImportRow(
      { rowNum: 2, name: 'X', sku: 'P200', categoryName: 'Tidak Ada', priceStr: '1', hppStr: '', stockStr: '', trackStockStr: '', unit: 'kg' },
      makeCtx(),
    );
    expect(row.isValid).toBe(false);
    expect(row.errors.some((e) => e.includes('excel.errorCatNotFound'))).toBe(true);
    expect(row.errors.some((e) => e.includes('excel.errorUnitNotFound'))).toBe(true);
  });

  it('flags invalid price and negative stock', () => {
    const row = validateImportRow(
      { rowNum: 2, name: 'X', sku: 'P300', categoryName: 'Minuman', priceStr: 'abc', hppStr: 'x', stockStr: '-2', trackStockStr: '', unit: 'pcs' },
      makeCtx(),
    );
    expect(row.isValid).toBe(false);
    expect(row.errors).toContain('excel.errorPriceInvalid');
    expect(row.errors).toContain('excel.errorHppInvalid');
    expect(row.errors).toContain('excel.errorStockInvalid');
  });

  it('skips stock validation when stock is not tracked', () => {
    const row = validateImportRow(
      { rowNum: 2, name: 'X', sku: 'P400', categoryName: 'Minuman', priceStr: '1', hppStr: '', stockStr: '-2', trackStockStr: 'tidak', unit: 'pcs' },
      makeCtx(),
    );
    expect(row.isValid).toBe(true);
    expect(row.trackStock).toBe(false);
  });
});
