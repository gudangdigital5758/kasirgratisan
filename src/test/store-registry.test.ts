import { beforeEach, describe, expect, it } from 'vitest';
import {
  storeRegistry,
  ensureDefaultStoreEntry,
  addStore,
  updateStore,
  removeStore,
  listStores,
  getActiveStoreKey,
  setActiveStoreKey,
  DEFAULT_STORE_KEY,
  dbNameForStore,
} from '@/lib/store-registry';
import { db, getDb } from '@/lib/db';

describe('store-registry — db name mapping', () => {
  it('maps default store to kasirgratisan-db', () => {
    expect(dbNameForStore(DEFAULT_STORE_KEY)).toBe('kasirgratisan-db');
  });

  it('maps extra stores to kasirgratisan-db-<key>', () => {
    expect(dbNameForStore('abc12345')).toBe('kasirgratisan-db-abc12345');
  });
});

describe('store-registry — CRUD', () => {
  beforeEach(async () => {
    await storeRegistry.stores.clear();
    localStorage.removeItem('profitku.activeStoreKey');
  });

  it('ensureDefaultStoreEntry creates idempotent default entry', async () => {
    const e1 = await ensureDefaultStoreEntry('Toko Uji');
    expect(e1.storeKey).toBe(DEFAULT_STORE_KEY);
    expect(e1.dbName).toBe('kasirgratisan-db');
    expect(e1.mode).toBe('local');

    const e2 = await ensureDefaultStoreEntry('Toko Uji');
    expect(e2.id).toBe(e1.id);
    expect(await listStores()).toHaveLength(1);
  });

  it('addStore creates unique storeKey and own dbName', async () => {
    const a = await addStore({ name: 'Toko 2', mode: 'local' });
    const b = await addStore({ name: 'Toko 3', mode: 'cloud', cloudStoreId: 'cs-1' });
    expect(a.storeKey).not.toBe(DEFAULT_STORE_KEY);
    expect(a.storeKey).not.toBe(b.storeKey);
    expect(a.dbName).toBe(`kasirgratisan-db-${a.storeKey}`);
    expect(b.mode).toBe('cloud');
    expect(b.cloudStoreId).toBe('cs-1');
  });

  it('updateStore and removeStore work', async () => {
    const a = await addStore({ name: 'Toko A', mode: 'local' });
    await updateStore(a.storeKey, { name: 'Toko A Baru' });
    const updated = (await listStores()).find((s) => s.storeKey === a.storeKey);
    expect(updated?.name).toBe('Toko A Baru');

    setActiveStoreKey(a.storeKey);
    await removeStore(a.storeKey);
    expect((await listStores()).some((s) => s.storeKey === a.storeKey)).toBe(false);
    expect(getActiveStoreKey()).toBe(DEFAULT_STORE_KEY); // reset ke default
  });
});

describe('store-registry — getDb factory', () => {
  beforeEach(async () => {
    await storeRegistry.stores.clear();
    localStorage.removeItem('profitku.activeStoreKey');
  });

  it('returns default db for default store', () => {
    expect(getDb(DEFAULT_STORE_KEY)).toBe(db);
  });

  it('creates a separate PosDatabase per extra store', async () => {
    const a = await addStore({ name: 'Toko 2', mode: 'local' });
    const dbA = getDb(a.storeKey);
    expect(dbA).not.toBe(db);
    expect(dbA.name).toBe(`kasirgratisan-db-${a.storeKey}`);
    // instance di-cache — panggilan kedua mengembalikan objek sama
    expect(getDb(a.storeKey)).toBe(dbA);
  });

  it('getDb() without arg uses active store key', async () => {
    const a = await addStore({ name: 'Toko 2', mode: 'local' });
    setActiveStoreKey(a.storeKey);
    expect(getDb()).toBe(getDb(a.storeKey));
    expect(getDb()).not.toBe(db);
  });
});
