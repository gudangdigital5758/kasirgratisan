/**
 * Validasi & parsing baris import produk via Excel — logika murni yang
 * diekstrak dari Products.tsx agar bisa diuji dan dipakai ulang.
 *
 * Pembacaan file (.xlsx via exceljs) tetap di komponen; logika per-baris
 * ada di sini.
 */

import type { Category, Unit } from '@/lib/db';

export interface ParsedRow {
  rowNum: number;
  name: string;
  sku: string;
  categoryName: string;
  price: number;
  hpp: number;
  trackStock: boolean;
  stock: number;
  unit: string;
  barcode?: string;
  description?: string;
  isValid: boolean;
  errors: string[];
}

export interface ImportRowInput {
  rowNum: number;
  name: string;
  sku: string;
  categoryName: string;
  priceStr: string;
  hppStr: string;
  stockStr: string;
  trackStockStr: string;
  unit: string;
  barcode?: string;
  description?: string;
}

export interface ImportValidationContext {
  /** Kategori aktif (untuk mencocokkan nama kategori). */
  categories: Category[];
  /** Unit aktif (untuk mencocokkan nama satuan). */
  units: Unit[];
  /** SKU yang sudah ada di database (lowercase, trim). */
  dbSkus: Set<string>;
  /** SKU -> nama produk, untuk pesan error yang informatif. */
  dbProductsBySku: Map<string, string>;
  /** Set SKU dalam file yang sedang diproses (mutable, lintas baris). */
  skuInFile: Set<string>;
  /** Fungsi i18n untuk pesan error. */
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/**
 * Parsing angka dari string Excel: menangani "Rp", spasi, pemisah ribuan
 * (titik/koma) dan desimal. Mengembalikan -1 bila tidak bisa diparsing.
 */
export function cleanNumber(val: string): number {
  if (!val) return 0;
  let clean = val.replace(/Rp/gi, '').replace(/\s+/g, '');
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');
  if (lastDot > lastComma) {
    clean = clean.replace(/,/g, '');
  } else if (lastComma > lastDot) {
    clean = clean.replace(/\./g, '').replace(/,/g, '.');
  } else {
    const match = clean.match(/[.,](\d+)$/);
    if (match) {
      const decimals = match[1];
      if (decimals.length === 3) {
        clean = clean.replace(/[.,]/g, '');
      } else {
        clean = clean.replace(/[.,]/g, '.');
      }
    }
  }
  const parsed = Number(clean);
  return isNaN(parsed) ? -1 : parsed;
}

/** Parsing kolom "Kelola Stok": default true; kata kunci negatif → false. */
export function parseTrackStock(trackStockStr: string): boolean {
  if (!trackStockStr) return true;
  const lower = trackStockStr.toLowerCase();
  return !(lower === 'tidak' || lower === 'no' || lower === 'false' || lower === '0' || lower === 'salah');
}

/** Validasi satu baris import → ParsedRow lengkap dengan daftar error. */
export function validateImportRow(input: ImportRowInput, ctx: ImportValidationContext): ParsedRow {
  const { name, sku, categoryName, priceStr, hppStr, stockStr, trackStockStr, unit } = input;
  const errors: string[] = [];

  if (!name) {
    errors.push(ctx.t('excel.errorNameRequired'));
  }
  if (!sku) {
    errors.push(ctx.t('excel.errorSkuRequired'));
  } else {
    const skuLower = sku.toLowerCase().trim();
    if (ctx.skuInFile.has(skuLower)) {
      errors.push(ctx.t('excel.errorSkuDupExcel'));
    } else {
      ctx.skuInFile.add(skuLower);
    }
    if (ctx.dbSkus.has(skuLower)) {
      const existingName = ctx.dbProductsBySku.get(skuLower);
      errors.push(ctx.t('excel.errorSkuDupDb') + ` ("${existingName}")`);
    }
  }

  // Kategori (case-insensitive)
  const matchedCat = ctx.categories.find(
    (c) => c.name.toLowerCase().trim() === categoryName.toLowerCase().trim(),
  );
  if (!categoryName) {
    errors.push(ctx.t('excel.errorCatNotFound'));
  } else if (!matchedCat) {
    errors.push(ctx.t('excel.errorCatNotFound') + `: "${categoryName}"`);
  }

  // Satuan (case-insensitive)
  const matchedUnit = ctx.units.find((u) => u.name.toLowerCase().trim() === unit.toLowerCase().trim());
  if (!unit) {
    errors.push(ctx.t('excel.errorUnitNotFound'));
  } else if (!matchedUnit) {
    errors.push(ctx.t('excel.errorUnitNotFound') + `: "${unit}"`);
  }

  const price = cleanNumber(priceStr);
  const hpp = hppStr ? cleanNumber(hppStr) : 0;
  const stock = stockStr ? cleanNumber(stockStr) : 0;
  const trackStock = parseTrackStock(trackStockStr);

  if (price < 0) {
    errors.push(ctx.t('excel.errorPriceInvalid'));
  }
  if (hpp < 0) {
    errors.push(ctx.t('excel.errorHppInvalid'));
  }
  if (trackStock && stock < 0) {
    errors.push(ctx.t('excel.errorStockInvalid'));
  }

  return {
    rowNum: input.rowNum,
    name,
    sku,
    categoryName,
    price: price >= 0 ? price : 0,
    hpp: hpp >= 0 ? hpp : 0,
    trackStock,
    stock: stock >= 0 ? stock : 0,
    unit,
    barcode: input.barcode,
    description: input.description,
    isValid: errors.length === 0,
    errors,
  };
}
