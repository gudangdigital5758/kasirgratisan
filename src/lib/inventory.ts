/**
 * Layanan FIFO inventory (STOK-FIFO).
 *
 * Model: setiap stok masuk membuat batch (`stockLots`). Setiap pengurangan
 * stok (penjualan/open bill, stock out, opname negatif, edit stok produk)
 * memakai batch tertua lebih dulu. Pemakaian batch per baris transaksi
 * dicatat di `stockLotAllocations` agar HPP historis tidak berubah saat
 * batch berikutnya masuk, dan agar pengembalian stok (batal open bill /
 * hapus transaksi) kembali ke batch asal.
 *
 * Seluruh fungsi di file ini AMAN dipanggil di dalam `db.transaction` Dexie:
 * pemanggil wajib menyertakan db.stockLots (+ db.stockLotAllocations saat
 * menulis alokasi) dalam scope transaksi agar operasi atomik.
 */

import {
  db,
  isStockManaged,
  type PosDatabase,
  type Product,
  type StockLot,
  type StockLotAllocation,
} from '@/lib/db';

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

export interface FifoConsumption {
  lots: StockLot[];
  allocations: Array<Omit<StockLotAllocation, 'id' | 'syncId' | 'syncedAt'>>;
  /** Total modal (Σ qty × unitCost). */
  costAmount: number;
  /** HPP rata-rata per unit baris (costAmount / qty); 0 bila tanpa stok. */
  unitCost: number;
}

const round2 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Batch aktif produk, diurutkan termuda → tertua (FIFO: pakai yang paling lama). */
export async function lotsForProduct(
  productId: number,
  target: PosDatabase = db,
): Promise<StockLot[]> {
  return target.stockLots
    .where('productId')
    .equals(productId)
    .filter((l) => l.quantityRemaining > 0)
    .sortBy('date');
}

/** Total sisa seluruh batch produk. */
export async function totalRemaining(
  productId: number,
  target: PosDatabase = db,
): Promise<number> {
  const lots = await lotsForProduct(productId, target);
  return round2(lots.reduce((s, l) => s + l.quantityRemaining, 0));
}

/**
 * Buat batch stok baru. Tidak menyentuh `products.stock` — pemanggil
 * menyesuaikan stok produk sendiri (dalam transaksi yang sama).
 */
export async function addStockLot(
  input: Pick<StockLot, 'productId' | 'quantity' | 'unitCost' | 'date' | 'source'> &
    Partial<Pick<StockLot, 'stockInId'>>,
  target: PosDatabase = db,
): Promise<number> {
  const qty = round2(input.quantity);
  if (!(qty > 0)) throw new InventoryError('Kuantitas batch harus > 0');
  return (await target.stockLots.add({
    productId: input.productId,
    quantity: qty,
    quantityRemaining: qty,
    unitCost: Math.round(input.unitCost),
    date: input.date,
    source: input.source,
    stockInId: input.stockInId,
    updatedAt: new Date(),
  })) as number;
}

/**
 * Konsumsi stok FIFO: habiskan batch tertua dulu.
 * Menurunkan `quantityRemaining` tiap batch yang terpakai DAN `products.stock`
 * (diambil dari DB agar selalu segar). `product` hanya untuk nama/fallback.
 * `opts.updateProductStock=false` untuk pemanggil yang menetapkan
 * `products.stock` sendiri setelahnya (mis. stock opname ke nilai riil).
 * Lempar InventoryError bila stok batch tidak cukup.
 */
export async function consumeFifo(
  product: Pick<Product, 'id' | 'name' | 'hpp' | 'trackStock'>,
  qty: number,
  target: PosDatabase = db,
  opts: { updateProductStock?: boolean } = {},
): Promise<FifoConsumption> {
  const amount = round2(qty);
  if (amount <= 0) {
    return { lots: [], allocations: [], costAmount: 0, unitCost: 0 };
  }
  if (!isStockManaged(product)) {
    return {
      lots: [],
      allocations: [],
      costAmount: Math.round(product.hpp) * amount,
      unitCost: Math.round(product.hpp),
    };
  }

  const fresh = ((await target.products.get(product.id!)) ?? product) as Pick<
    Product, 'id' | 'name' | 'stock' | 'hpp' | 'trackStock'
  >;
  const lots = await lotsForProduct(product.id!, target);
  const available = round2(lots.reduce((s, l) => s + l.quantityRemaining, 0));

  // Legacy: produk dikelola stoknya tapi belum punya batch (data lama /
  // produk tanpa riwayat batch). Perilaku lama: kurangi stok langsung,
  // HPP memakai products.hpp, tanpa alokasi batch.
  if (lots.length === 0 && available === 0) {
    if (amount > (fresh.stock ?? 0)) {
      throw new InventoryError(
        `Stok tidak cukup untuk "${product.name}" (tersedia ${fresh.stock ?? 0}, diminta ${amount}).`,
      );
    }
    if (opts.updateProductStock !== false) {
      await target.products.update(product.id!, {
        stock: round2((fresh.stock ?? 0) - amount),
        updatedAt: new Date(),
        // CLOUD-003: perubahan stok harus ikut sync → tandai dirty.
        syncedAt: null,
      });
    }
    const legacyCost = Math.round(fresh.hpp ?? 0) * amount;
    return {
      lots: [],
      allocations: [],
      costAmount: legacyCost,
      unitCost: legacyCost / amount,
    };
  }

  if (amount > available) {
    throw new InventoryError(
      `Stok tidak cukup untuk "${product.name}" (tersedia ${available}, diminta ${amount}).`,
    );
  }

  let remaining = amount;
  let costAmount = 0;
  const consumed: Array<{ lot: StockLot; take: number }> = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantityRemaining, remaining);
    await target.stockLots.update(lot.id!, {
      quantityRemaining: round2(lot.quantityRemaining - take),
      updatedAt: new Date(),
      syncedAt: null,
    });
    costAmount += take * lot.unitCost;
    remaining = round2(remaining - take);
    consumed.push({ lot, take });
  }

  if (remaining > 0) {
    throw new InventoryError(
      `Stok FIFO tidak cukup untuk "${product.name}" (sisa batch ${round2(amount - remaining)}/${amount}).`,
    );
  }

  if (opts.updateProductStock !== false) {
    const after = await lotsForProduct(product.id!, target);
    const stock = round2(after.reduce((s, l) => s + l.quantityRemaining, 0));
    const hpp = after.length > 0 ? after[0].unitCost : Math.round(fresh.hpp ?? 0);
    await target.products.update(product.id!, { stock, hpp, updatedAt: new Date(), syncedAt: null });
  }

  const cost = Math.round(costAmount);
  return {
    lots: consumed.map((c) => c.lot),
    allocations: consumed.map((c) => ({
      stockLotId: c.lot.id as number,
      transactionItemId: 0, // diisi pemanggil setelah item dibuat
      transactionId: 0,
      productId: product.id as number,
      quantity: c.take,
      costAmount: Math.round(c.take * c.lot.unitCost),
    })),
    costAmount: cost,
    unitCost: amount > 0 ? cost / amount : 0,
  };
}

/**
 * Kembalikan stok ke batch asal (batal open bill / hapus transaksi dengan
 * restore). Bila batch asal masih ada, kuantitasnya ditambah kembali;
 * bila batch asal sudah hilang (mis. transaksi lama dari sebelum FIFO),
 * buat batch 'restore' baru dengan harga modal historis item.
 */
export async function restoreToLot(
  allocation: Pick<StockLotAllocation, 'stockLotId' | 'quantity' | 'costAmount' | 'productId'>,
  target: PosDatabase = db,
): Promise<void> {
  const qty = round2(allocation.quantity);
  if (qty <= 0) return;
  const lot = await target.stockLots.get(allocation.stockLotId);
  if (lot) {
    await target.stockLots.update(lot.id!, {
      quantityRemaining: round2(lot.quantityRemaining + qty),
      updatedAt: new Date(),
      syncedAt: null,
    });
    const product = await target.products.get(allocation.productId);
    if (product && isStockManaged(product)) {
      await target.products.update(product.id!, {
        stock: round2((product.stock ?? 0) + qty),
        updatedAt: new Date(),
        syncedAt: null,
      });
    }
    return;
  }
  // Batch asal hilang → buat batch pengembalian dengan harga modal historis item.
  const unitCost = qty > 0 ? Math.round((allocation.costAmount ?? 0) / qty) : 0;
  await addStockLot(
    {
      productId: allocation.productId,
      quantity: qty,
      unitCost,
      date: new Date(),
      source: 'restore',
    },
    target,
  );
  const product = await target.products.get(allocation.productId);
  if (product && isStockManaged(product)) {
    await target.products.update(product.id!, {
      stock: round2((product.stock ?? 0) + qty),
      updatedAt: new Date(),
      syncedAt: null,
    });
  }
}

/** HPP batch aktif (batch tertua yang tersisa); fallback hpp produk. */
export async function activeLotUnitCost(
  product: Pick<Product, 'id' | 'hpp' | 'trackStock'>,
  target: PosDatabase = db,
): Promise<number> {
  if (!isStockManaged(product)) return Math.round(product.hpp);
  const lots = await lotsForProduct(product.id!, target);
  return lots.length > 0 ? lots[0].unitCost : Math.round(product.hpp);
}

/**
 * Samakan `products.stock` dan `products.hpp` dengan kondisi batch terkini.
 * `products.stock` = total quantityRemaining seluruh batch;
 * `products.hpp` = harga modal batch tertua (nilai yang ditampilkan UI).
 * Dipanggil oleh pemanggil dalam transaksi yang mencakup products + stockLots.
 */
export async function reconcileProductFromLots(
  productId: number,
  target: PosDatabase = db,
): Promise<void> {
  const product = await target.products.get(productId);
  if (!product) return;
  const lots = await lotsForProduct(productId, target);
  const stock = round2(lots.reduce((s, l) => s + l.quantityRemaining, 0));
  const hpp = lots.length > 0 ? lots[0].unitCost : Math.round(product.hpp ?? 0);
  await target.products.update(productId, {
    stock,
    hpp,
    updatedAt: new Date(),
    syncedAt: null,
  });
}

/** Hapus alokasi batch untuk sebuah item transaksi (saat item dihapus). */
export async function deleteAllocationsForItem(
  transactionItemId: number,
  target: PosDatabase = db,
): Promise<void> {
  await target.stockLotAllocations.where('transactionItemId').equals(transactionItemId).delete();
}

/** Hapus semua alokasi batch sebuah transaksi (saat transaksi dihapus). */
export async function deleteAllocationsForTransaction(
  transactionId: number,
  target: PosDatabase = db,
): Promise<void> {
  await target.stockLotAllocations.where('transactionId').equals(transactionId).delete();
}

/**
 * Hapus transaksi + item + alokasi batch secara atomik. Bila `restoreStock`,
 * stok dikembalikan ke batch asal (alokasi FIFO) atau menjadi batch
 * 'restore' baru (transaksi legacy tanpa alokasi).
 */
export async function deleteTransactionAtomic(
  transactionId: number,
  restoreStock: boolean,
  target: PosDatabase = db,
): Promise<void> {
  await target.transaction('rw', target.transactions, target.transactionItems, target.stockLots,
    target.stockLotAllocations, target.products, async () => {
    const items = await target.transactionItems.where('transactionId').equals(transactionId).toArray();
    if (restoreStock) {
      for (const item of items) {
        const allocations = await target.stockLotAllocations
          .where('transactionItemId')
          .equals(item.id as number)
          .toArray();
        if (allocations.length === 0) {
          // Transaksi legacy (sebelum FIFO) tanpa alokasi: kembalikan ke
          // batch saldo awal bila produk dikelola stoknya.
          const product = await target.products.get(item.productId);
          if (product && isStockManaged(product)) {
            await target.products.update(item.productId, {
              stock: (product.stock ?? 0) + item.quantity,
              updatedAt: new Date(),
            });
          }
          continue;
        }
        for (const a of allocations) {
          await restoreToLot(a, target);
        }
      }
    }
    await target.stockLotAllocations.where('transactionId').equals(transactionId).delete();
    await target.transactionItems.where('transactionId').equals(transactionId).delete();
    await target.transactions.delete(transactionId);
  });
}
