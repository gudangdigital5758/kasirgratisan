import { describe, expect, it } from 'vitest';
import {
  PRODUCT_FIELDS,
  STORE_TYPES,
  cleanAttributes,
  getDisplayAttributes,
  getMissingRequiredFields,
  getProductFields,
  getVisibleFields,
  normalizeStoreType,
} from '@/lib/product-fields';

describe('product-fields — normalizeStoreType', () => {
  it('unknown/empty falls back to general', () => {
    expect(normalizeStoreType(undefined)).toBe('general');
    expect(normalizeStoreType(null)).toBe('general');
    expect(normalizeStoreType('')).toBe('general');
    expect(normalizeStoreType('bogus')).toBe('general');
  });

  it('keeps known types', () => {
    expect(normalizeStoreType('shoes')).toBe('shoes');
    expect(normalizeStoreType('cosmetics')).toBe('cosmetics');
    expect(normalizeStoreType('other')).toBe('other');
    expect(normalizeStoreType('general')).toBe('general');
  });
});

describe('product-fields — schemas', () => {
  it('STORE_TYPES covers exactly 4 types', () => {
    expect(STORE_TYPES.map(s => s.value).sort()).toEqual(['cosmetics', 'general', 'other', 'shoes']);
  });

  it('general has no special columns', () => {
    expect(PRODUCT_FIELDS.general).toEqual([]);
  });

  it('shoes defines required brand/size/category/condition + conditional conditionDetail', () => {
    const shoes = PRODUCT_FIELDS.shoes;
    expect(shoes.find(f => f.key === 'brand')?.required).toBe(true);
    expect(shoes.find(f => f.key === 'size')?.required).toBe(true);
    expect(shoes.find(f => f.key === 'category')?.required).toBe(true);
    expect(shoes.find(f => f.key === 'condition')?.required).toBe(true);
    const detail = shoes.find(f => f.key === 'conditionDetail');
    expect(detail?.dependsOn).toEqual({ key: 'condition', value: 'used' });
  });

  it('cosmetics requires bpom/halal/expiry', () => {
    const cosmetics = PRODUCT_FIELDS.cosmetics;
    for (const key of ['bpomNumber', 'halalNumber', 'expiryDate']) {
      expect(cosmetics.find(f => f.key === key)?.required).toBe(true);
    }
  });
});

describe('product-fields — visible & required', () => {
  it('conditionDetail only visible when condition=used', () => {
    const attrsNew = { condition: 'new' };
    const attrsUsed = { condition: 'used' };
    const visibleNew = getVisibleFields('shoes', attrsNew);
    const visibleUsed = getVisibleFields('shoes', attrsUsed);
    expect(visibleNew.some(f => f.key === 'conditionDetail')).toBe(false);
    expect(visibleUsed.some(f => f.key === 'conditionDetail')).toBe(true);
  });

  it('missing required fields reported correctly', () => {
    const missing = getMissingRequiredFields('shoes', { brand: 'Nike' });
    const keys = missing.map(f => f.key).sort();
    // size, category, condition wajib; conditionDetail belum (condition kosong)
    expect(keys).toEqual(['category', 'condition', 'size']);
  });

  it('no missing when all filled', () => {
    const attrs = { brand: 'Nike', size: '42', category: 'Running', condition: 'new' };
    expect(getMissingRequiredFields('shoes', attrs)).toEqual([]);
  });

  it('conditionDetail required only when condition=used', () => {
    // condition belum diisi -> conditionDetail tidak tampil, tidak wajib
    const missingNew = getMissingRequiredFields('shoes', { condition: 'new' });
    expect(missingNew.some(f => f.key === 'conditionDetail')).toBe(false);
    // condition=used tapi conditionDetail kosong -> wajib
    const missingUsed = getMissingRequiredFields('shoes', {
      brand: 'Nike', size: '42', category: 'Running', condition: 'used',
    });
    expect(missingUsed.map(f => f.key)).toEqual(['conditionDetail']);
    // conditionDetail terisi -> lolos
    expect(getMissingRequiredFields('shoes', {
      brand: 'Nike', size: '42', category: 'Running', condition: 'used', conditionDetail: 'baik',
    })).toEqual([]);
  });

  it('custom fields merged with builtin and validated', () => {
    const custom = [{ key: 'warna', label: 'Warna', type: 'text' as const, required: true }];
    const fields = getProductFields('other', custom);
    expect(fields.map(f => f.key)).toEqual(['warna']);
    expect(getMissingRequiredFields('other', {}, custom).map(f => f.key)).toEqual(['warna']);
    expect(getMissingRequiredFields('other', { warna: 'Merah' }, custom)).toEqual([]);
  });
});

describe('product-fields — clean & display', () => {
  it('cleanAttributes drops empty values', () => {
    expect(cleanAttributes({ a: 'x', b: '', c: undefined, d: null, e: 0 })).toEqual({ a: 'x', e: 0 });
  });

  it('getDisplayAttributes returns only filled visible fields', () => {
    const attrs = { brand: 'Nike', size: '42', condition: 'used', conditionDetail: 'baik' };
    const display = getDisplayAttributes('shoes', attrs);
    const keys = display.map(d => d.field.key).sort();
    expect(keys).toEqual(['brand', 'condition', 'conditionDetail', 'size']);
  });

  it('empty attributes → empty display', () => {
    expect(getDisplayAttributes('shoes', undefined)).toEqual([]);
    expect(getDisplayAttributes('shoes', {})).toEqual([]);
  });
});
