import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { resolveInitialSync } from '@/lib/sync';
import { setCloudTokenGetter } from '@/lib/cloud-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Initial sync source selection', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setCloudTokenGetter(() => 'test-token');
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();
    await db.syncMeta.clear();
    await db.syncQueue.clear();
    await db.localBackups.clear();
  });

  afterEach(async () => {
    await db.products.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.transactionItems.clear();
    await db.storeSettings.clear();
    await db.syncMeta.clear();
    await db.syncQueue.clear();
    await db.localBackups.clear();
    vi.unstubAllGlobals();
  });

  async function seedSettings() {
    await db.storeSettings.add({
      storeName: 'Initial Store', address: '', phone: '', receiptFooter: '',
      onboardingDone: true, lastBackupAt: null, deviceId: 'initial-device',
      cloudStoreId: 'cloud-store-id',
    });
    await db.syncMeta.put({
      id: 1, lastPullCursor: null, lastSyncAt: null,
      initialSyncRequired: true, lastSyncError: 'source required',
    });
  }

  it('Gunakan Data Cloud membuat snapshot lalu mengganti data bisnis lokal', async () => {
    await seedSettings();
    await db.products.add({
      name: 'Lokal', sku: 'LOCAL', categoryId: 1, price: 1000, hpp: 500, stock: 1,
      unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/pull')) {
        return jsonResponse({
          records: [{
            table: 'products',
            syncId: '55555555-5555-4555-8555-555555555555',
            data: { name: 'Cloud', sku: 'CLOUD', categoryId: 1, price: 2000, hpp: 1000, stock: 2, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T12:00:00.000Z' },
            updatedAt: '2026-08-05T12:00:01.000Z',
          }],
          tombstones: [],
          serverTime: '2026-08-05T12:00:02.000Z',
          cursor: '2026-08-05T12:00:01.000Z|1',
          hasMore: false,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    }));

    const result = await resolveInitialSync('cloud');
    expect(result.ok).toBe(true);
    expect((await db.products.toArray()).map((p) => p.name)).toEqual(['Cloud']);
    expect(await db.localBackups.count()).toBe(1);
    expect((await db.syncMeta.get(1))?.initialSyncRequired).toBe(false);
  });

  it('Pertahankan Data Lokal menandai local rows dirty dan push ke cloud', async () => {
    await seedSettings();
    await db.products.add({
      name: 'Lokal', sku: 'LOCAL', categoryId: 1, price: 1000, hpp: 500, stock: 1,
      unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { records?: Record<string, { syncId: string }[]> };
        const syncId = body.records?.products?.[0]?.syncId;
        return jsonResponse({ accepted: syncId ? [syncId] : [], count: syncId ? 1 : 0, serverTime: '2026-08-05T13:00:00.000Z', winners: [] });
      }
      if (url.includes('/api/sync/pull')) {
        return jsonResponse({ records: [], tombstones: [], serverTime: '2026-08-05T13:00:01.000Z', cursor: '2026-08-05T13:00:00.000Z|1', hasMore: false });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveInitialSync('local');
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/sync/push'))).toBe(true);
    expect((await db.syncMeta.get(1))?.initialSyncRequired).toBe(false);
  });
});
