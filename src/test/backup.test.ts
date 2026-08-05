import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { buildBackupData, restoreFromBackupData, BACKUP_VERSION } from '@/lib/backup';

describe('Backup and Restore Logic', () => {
  beforeEach(async () => {
    // Clear tables before each test
    await db.categories.clear();
    await db.products.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
  });

  afterEach(async () => {
    await db.categories.clear();
    await db.products.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
  });

  it('should include stockOpnames and stockOpnameItems in buildBackupData', async () => {
    // Add dummy data to tables
    await db.categories.add({ id: 1, name: 'Category 1', color: '', icon: '', isDeleted: 0, createdAt: new Date(), deletedAt: null });
    await db.products.add({
      id: 1, name: 'Product 1', sku: 'P1', categoryId: 1, price: 10000, hpp: 5000, stock: 10, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    
    // Add stock opname data
    await db.stockOpnames.add({
      id: 1,
      date: new Date(),
      status: 'completed',
      createdBy: 1,
      notes: 'Test Opname'
    });
    await db.stockOpnameItems.add({
      id: 1,
      opnameId: 1,
      productId: 1,
      systemStock: 10,
      realStock: 8,
      difference: -2
    });

    const backup = await buildBackupData();

    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.categories).toHaveLength(1);
    expect(backup.products).toHaveLength(1);
    expect(backup.stockOpnames).toHaveLength(1);
    expect(backup.stockOpnameItems).toHaveLength(1);
    expect(backup.stockOpnames[0].notes).toBe('Test Opname');
    expect(backup.stockOpnameItems[0].difference).toBe(-2);
  });

  it('should restore stockOpnames and stockOpnameItems successfully', async () => {
    const mockBackup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      categories: [{ id: 2, name: 'Category 2', isDeleted: 0 }],
      products: [{ id: 2, name: 'Product 2', sku: 'P2', categoryId: 2, isDeleted: 0 }],
      stockOpnames: [{ id: 5, date: new Date().toISOString(), status: 'draft', createdBy: 'user2', notes: 'Draft Opname' }],
      stockOpnameItems: [{ id: 5, opnameId: 5, productId: 2, systemStock: 5, actualStock: 5, difference: 0 }],
    };

    await restoreFromBackupData(mockBackup);

    const categories = await db.categories.toArray();
    const products = await db.products.toArray();
    const stockOpnames = await db.stockOpnames.toArray();
    const stockOpnameItems = await db.stockOpnameItems.toArray();

    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('Category 2');
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Product 2');
    expect(stockOpnames).toHaveLength(1);
    expect(stockOpnames[0].notes).toBe('Draft Opname');
    expect(stockOpnames[0].date).toBeInstanceOf(Date);
    expect(stockOpnameItems).toHaveLength(1);
    expect(stockOpnameItems[0].difference).toBe(0);
  });
});
