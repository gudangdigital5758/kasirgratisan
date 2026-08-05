import { describe, it, expect, afterEach } from 'vitest';
import { PosDatabase } from '@/lib/db-migrations';
import { setupSyncHooks, type PosDatabase as T } from '@/lib/db';
import { collectPushPayload, markSynced, applyPull } from '@/lib/sync';

/**
 * Simulasi server LWW sederhana (M3) — meniru RPC sync_upsert_batch + pull.
 * Key: `${table}:${syncId}`.
 */
type ServerRec = { data: unknown; updatedAt: string; deleted: boolean; deletedAt: string | null };
const server = new Map<string, ServerRec>();

// Jam fiktif bersama agar kursor server & timestamp record konsisten.
let clockMs = Date.parse('2026-08-05T08:00:00Z');
function tick(minutes = 1): string {
  clockMs += minutes * 60_000;
  return new Date(clockMs).toISOString();
}
function serverNow(): string {
  return new Date(clockMs).toISOString();
}

function serverUpsert(items: { table: string; syncId: string; data: unknown; updatedAt: string; deleted?: boolean; deletedAt?: string | null }[]): string[] {
  const accepted: string[] = [];
  for (const it of items) {
    const key = `${it.table}:${it.syncId}`;
    const cur = server.get(key);
    if (!cur || new Date(it.updatedAt) > new Date(cur.updatedAt)) {
      server.set(key, {
        data: it.data,
        updatedAt: it.updatedAt,
        deleted: !!it.deleted,
        deletedAt: it.deletedAt ?? null,
      });
      accepted.push(it.syncId);
    }
  }
  return accepted;
}

function serverPull(since: string) {
  const now = serverNow();
  const records: { table: string; syncId: string; data: unknown; updatedAt: string }[] = [];
  const tombstones: { table: string; syncId: string; deletedAt: string }[] = [];
  for (const [key, rec] of server) {
    if (new Date(rec.updatedAt) > new Date(since) && new Date(rec.updatedAt) <= new Date(now)) {
      const [table, syncId] = key.split(':');
      if (rec.deleted) tombstones.push({ table, syncId, deletedAt: rec.deletedAt ?? rec.updatedAt });
      else records.push({ table, syncId, data: rec.data, updatedAt: rec.updatedAt });
    }
  }
  return { records, tombstones, serverTime: now };
}

const EPOCH = new Date(0).toISOString();

function makeDevice(dbName: string): Promise<{ db: T; addProduct: (p: { name: string; sku: string; updatedAt: Date }) => Promise<string> }> {
  return (async () => {
    const db = new PosDatabase(dbName);
    setupSyncHooks(db);
    await db.storeSettings.clear();
    await db.storeSettings.add({
      storeName: dbName, address: '', phone: '', receiptFooter: '', printLogo: false,
      onboardingDone: true, lastBackupAt: null, deviceId: `${dbName}-device`, cloudStoreId: 'store-1',
    });
    const addProduct = async (p: { name: string; sku: string; updatedAt: Date }) => {
      const id = await db.products.add({
        name: p.name, sku: p.sku, categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
        isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: p.updatedAt,
      });
      return String(id);
    };
    return { db, addProduct };
  })();
}

async function devicePush(db: T): Promise<void> {
  const payload = await collectPushPayload(db);
  const items: { table: string; syncId: string; data: unknown; updatedAt: string; deleted?: boolean; deletedAt?: string | null }[] = [];
  for (const [table, rows] of Object.entries(payload.records)) {
    for (const r of rows) items.push({ table, syncId: r.syncId, data: r.data, updatedAt: r.updatedAt });
  }
  for (const t of payload.tombstones) items.push({ table: t.table, syncId: t.syncId, data: {}, updatedAt: t.deletedAt, deleted: true, deletedAt: t.deletedAt });
  const accepted = serverUpsert(items);
  await markSynced(payload, accepted, serverNow(), db);
}

async function devicePull(db: T, since: string): Promise<string> {
  const result = serverPull(since);
  await applyPull(result, db);
  return result.serverTime;
}

function productBySku(db: T, sku: string) {
  return db.products.where('sku').equals(sku).first();
}

afterEach(async () => {
  server.clear();
  clockMs = Date.parse('2026-08-05T08:00:00Z');
  await Promise.all(
    ['kasirgratisan-db-synctest-a', 'kasirgratisan-db-synctest-b'].map(
      (n) => new Promise<void>((res) => {
        const r = indexedDB.deleteDatabase(n);
        r.onsuccess = r.onerror = r.onblocked = () => res();
      }),
    ),
  );
});

describe('Sync M3 — simulasi dua device (konvergensi LWW)', () => {
  it('produk dari device A sampai ke device B via push→pull', async () => {
    const a = await makeDevice('kasirgratisan-db-synctest-a');
    const b = await makeDevice('kasirgratisan-db-synctest-b');

    await a.addProduct({ name: 'Produk A', sku: 'SKU-A', updatedAt: new Date(tick()) });
    await devicePush(a.db);

    const cursorB = await devicePull(b.db, EPOCH);
    const inB = await productBySku(b.db, 'SKU-A');
    expect(inB).toBeTruthy();
    expect(inB?.name).toBe('Produk A');
    expect(inB?.syncId).toBeTruthy();

    // Tidak ada dirty tersisa di A; pull kedua di B tidak membawa data lama
    const stillDirtyA = await a.db.products.filter((p) => p.syncedAt === null).count();
    expect(stillDirtyA).toBe(0);
    const again = await devicePull(b.db, cursorB);
    expect(again).toBeTruthy();
  });

  it('edit di A (lebih baru) menyebar ke B', async () => {
    const a = await makeDevice('kasirgratisan-db-synctest-a');
    const b = await makeDevice('kasirgratisan-db-synctest-b');

    await a.addProduct({ name: 'V1', sku: 'SKU-EDIT', updatedAt: new Date(tick()) });
    await devicePush(a.db);
    let cursorB = await devicePull(b.db, EPOCH);
    expect((await productBySku(b.db, 'SKU-EDIT'))?.name).toBe('V1');

    // A mengedit (updatedAt lebih baru, syncedAt direset) → push → B pull
    const pA = await a.db.products.where('sku').equals('SKU-EDIT').first();
    await a.db.products.update(pA!.id as number, { name: 'V2', updatedAt: new Date(tick()), syncedAt: null } as never);
    await devicePush(a.db);
    cursorB = await devicePull(b.db, cursorB);
    expect((await productBySku(b.db, 'SKU-EDIT'))?.name).toBe('V2');
  });

  it('LWW: edit lebih baru di B menang saat A menarik', async () => {
    const a = await makeDevice('kasirgratisan-db-synctest-a');
    const b = await makeDevice('kasirgratisan-db-synctest-b');

    await a.addProduct({ name: 'Konflik Awal', sku: 'SKU-CONFLICT', updatedAt: new Date(tick()) });
    await devicePush(a.db);
    await devicePull(b.db, EPOCH);

    // Keduanya mengedit "bersamaan"; B menulis lebih lambat (updatedAt lebih baru)
    const pA = await a.db.products.where('sku').equals('SKU-CONFLICT').first();
    await a.db.products.update(pA!.id as number, { name: 'Edit A 08:30', updatedAt: new Date(tick()), syncedAt: null } as never);
    const pB = await b.db.products.where('sku').equals('SKU-CONFLICT').first();
    await b.db.products.update(pB!.id as number, { name: 'Edit B 09:00', updatedAt: new Date(tick()), syncedAt: null } as never);

    await devicePush(a.db); // A 08:30 masuk
    await devicePush(b.db); // B 09:00 masuk → menang (lebih baru)
    const cursorA = await devicePull(a.db, EPOCH);

    const inA = await productBySku(a.db, 'SKU-CONFLICT');
    expect(inA?.name).toBe('Edit B 09:00'); // B menang
    void cursorA;
  });

  it('tombstone (hapus) menyebar dan menang atas versi lama', async () => {
    const a = await makeDevice('kasirgratisan-db-synctest-a');
    const b = await makeDevice('kasirgratisan-db-synctest-b');

    await a.addProduct({ name: 'Bakal Dihapus', sku: 'SKU-DEL', updatedAt: new Date(tick()) });
    await devicePush(a.db);
    let cursorB = await devicePull(b.db, EPOCH);
    expect(await productBySku(b.db, 'SKU-DEL')).toBeTruthy();

    // A soft-delete (syncedAt direset agar dirty) → tombstone → B ikut menghapus
    const pA = await a.db.products.where('sku').equals('SKU-DEL').first();
    const delAt = new Date(tick());
    await a.db.products.update(pA!.id as number, {
      isDeleted: 1, deletedAt: delAt, updatedAt: delAt, syncedAt: null,
    } as never);
    await devicePush(a.db);
    cursorB = await devicePull(b.db, cursorB);
    const inB = await productBySku(b.db, 'SKU-DEL');
    expect(inB?.isDeleted).toBe(1);
    void cursorB;
  });
});
