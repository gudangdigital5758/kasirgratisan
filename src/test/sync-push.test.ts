import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { collectPushPayload, markSynced, syncNow } from '@/lib/sync';
import { setCloudTokenGetter } from '@/lib/cloud-api';
import type { SyncPushResult, SyncPullResult } from '@/lib/cloud-api';

const SERVER_TIME = '2026-08-05T10:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Sync pipeline PUSH (M2)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setCloudTokenGetter(() => 'test-token');
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();
    await db.deletedRecords.clear();
    await db.syncMeta.clear();
    await db.syncQueue.clear();

    await db.storeSettings.add({
      storeName: 'Test Sync Store',
      address: '',
      phone: '',
      receiptFooter: '',
      printLogo: false,
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device-id',
      cloudStoreId: 'test-cloud-store-id',
    });
  });

  afterEach(async () => {
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();
    await db.deletedRecords.clear();
    await db.syncMeta.clear();
    await db.syncQueue.clear();
    vi.unstubAllGlobals();
  });

  it('collectPushPayload only includes dirty (unsynced) records and strips local ids', async () => {
    const categoryId = await db.categories.add({
      name: 'Sync Category', color: '#FF0000', icon: '📁',
      createdAt: new Date(), isDeleted: 0, deletedAt: null,
    });
    const productId = await db.products.add({
      name: 'Sync Product', sku: 'SYNCP001', categoryId,
      price: 15000, hpp: 9000, stock: 20, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const payload = await collectPushPayload();
    expect(payload.records.categories).toHaveLength(1);
    expect(payload.records.products).toHaveLength(1);

    const pItem = payload.records.products[0];
    expect(pItem.syncId).toBeTruthy();
    expect(pItem.data).not.toHaveProperty('id');
    expect(pItem.data).not.toHaveProperty('syncId');
    expect(pItem.data).not.toHaveProperty('syncedAt');
    expect((pItem.data as { name?: string }).name).toBe('Sync Product');

    // Tandai category synced -> tidak muncul lagi saat collect berikutnya
    await markSynced(payload, [payload.records.categories[0].syncId], SERVER_TIME);
    const again = await collectPushPayload();
    expect(again.records.categories).toBeUndefined();
    expect(again.records.products).toHaveLength(1);
    void productId;
    void categoryId;
  });

  it('syncNow pushes dirty, marks ack, then pulls and stores cursor', async () => {
    await db.products.add({
      name: 'Dirty', sku: 'D1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const pushResult: SyncPushResult = { accepted: [], count: 0, serverTime: SERVER_TIME };
    const pullResult: SyncPullResult = { records: [], tombstones: [], serverTime: '2026-08-05T10:00:01.000Z' };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { records: Record<string, unknown[]> };
        const first = Object.values(body.records)[0]?.[0] as { syncId?: string } | undefined;
        pushResult.accepted = first?.syncId ? [first.syncId] : [];
        pushResult.count = pushResult.accepted.length;
        return jsonResponse(pushResult);
      }
      if (url.includes('/api/sync/pull')) return jsonResponse(pullResult);
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await syncNow();
    expect(res.ok).toBe(true);

    // fetch dipanggil untuk push & pull
    const pushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/push'));
    const pullCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/pull'));
    expect(pushCalls.length).toBe(1);
    expect(pullCalls.length).toBe(1);

    // record kini tersinkron
    const dirty = await db.products.filter((p) => p.syncedAt === null).count();
    expect(dirty).toBe(0);
    const meta = await db.syncMeta.get(1);
    expect(meta?.lastPullCursor).toBe(pullResult.serverTime);
    expect(meta?.lastSyncAt).toBeTruthy();
  });

  it('does NOT mark records synced when push fails (fail-closed)', async () => {
    await db.products.add({
      name: 'Dirty2', sku: 'D2', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'gagal' }, 500)));

    const res = await syncNow();
    expect(res.ok).toBe(false);
    const dirty = await db.products.filter((p) => p.syncedAt === null).count();
    expect(dirty).toBeGreaterThan(0);
    expect(await db.syncQueue.count()).toBe(1);
  });

  it('retry queue mengirim ulang batch dan menghapus queue setelah ack', async () => {
    await db.products.add({
      name: 'Queued', sku: 'QUEUE-1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    let pushCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        pushCalls++;
        if (pushCalls === 1) return jsonResponse({ error: 'temporary' }, 503);
        const body = JSON.parse(String(init?.body ?? '{}')) as { records?: Record<string, { syncId: string }[]> };
        const syncId = body.records?.products?.[0]?.syncId;
        return jsonResponse({ accepted: syncId ? [syncId] : [], count: syncId ? 1 : 0, serverTime: '2026-08-05T10:00:00.000Z' });
      }
      if (url.includes('/api/sync/pull')) {
        return jsonResponse({ records: [], tombstones: [], serverTime: '2026-08-05T10:00:01.000Z', cursor: '2026-08-05T10:00:00.000Z|1', hasMore: false });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await syncNow()).ok).toBe(false);
    const queued = await db.syncQueue.toArray();
    expect(queued).toHaveLength(1);
    await db.syncQueue.update(queued[0].id as number, { nextAttemptAt: new Date(0) });

    expect((await syncNow()).ok).toBe(true);
    expect(await db.syncQueue.count()).toBe(0);
    expect(await db.products.filter((p) => p.syncedAt !== null).count()).toBe(1);
  });

  it('menerapkan winner server dari acknowledgement push', async () => {
    const syncId = '44444444-4444-4444-8444-444444444444';
    const id = await db.products.add({
      name: 'Versi Lokal', sku: 'WINNER-1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs',
      syncId, isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date('2026-08-05T09:00:00.000Z'),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        return jsonResponse({
          accepted: [syncId],
          count: 1,
          serverTime: '2026-08-05T10:00:00.000Z',
          winners: [{
            table: 'products',
            syncId,
            data: { name: 'Versi Server', sku: 'WINNER-1', categoryId: 1, price: 2000, hpp: 500, stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T08:00:00.000Z' },
            updatedAt: '2026-08-05T10:00:00.000Z',
            deleted: false,
            deletedAt: null,
          }],
        });
      }
      if (url.includes('/api/sync/pull')) {
        return jsonResponse({ records: [], tombstones: [], serverTime: '2026-08-05T10:00:01.000Z', cursor: '2026-08-05T10:00:00.000Z|1', hasMore: false });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await syncNow()).ok).toBe(true);
    const product = await db.products.get(id as number);
    expect(product?.name).toBe('Versi Server');
    expect(product?.price).toBe(2000);
  });
});
