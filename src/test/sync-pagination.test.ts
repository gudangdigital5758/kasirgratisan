import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { syncNow } from '@/lib/sync';
import { setCloudTokenGetter } from '@/lib/cloud-api';
import type { SyncPullResult } from '@/lib/cloud-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Sync pull pagination (CLOUD-004)', () => {
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
      storeName: 'Test Store',
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

  it('pull multi-batch: menarik semua halaman dan menyimpan cursor timestamp+id', async () => {
    const batch1: SyncPullResult = {
      records: [
        {
          table: 'products',
          syncId: '11111111-1111-4111-8111-111111111111',
          data: { name: 'Produk Batch 1', sku: 'B1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T09:00:00.000Z' },
          updatedAt: '2026-08-05T09:01:00.000Z',
        },
      ],
      tombstones: [],
      serverTime: '2026-08-05T09:02:00.000Z',
      nextCursor: '2026-08-05T09:01:00.000Z|2000',
      cursor: '2026-08-05T09:01:00.000Z|2000',
      hasMore: true,
    };
    const batch2: SyncPullResult = {
      records: [
        {
          table: 'products',
          syncId: '22222222-2222-4222-8222-222222222222',
          data: { name: 'Produk Batch 2', sku: 'B2', categoryId: 1, price: 2000, hpp: 1000, stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T09:03:00.000Z' },
          updatedAt: '2026-08-05T09:04:00.000Z',
        },
      ],
      tombstones: [],
      serverTime: '2026-08-05T09:05:00.000Z',
      nextCursor: undefined,
      cursor: '2026-08-05T09:04:00.000Z|2001',
      hasMore: false,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        return jsonResponse({ accepted: [], count: 0, serverTime: '2026-08-05T09:00:00.000Z' });
      }
      if (url.includes('/api/sync/pull')) {
        // Batch 2 dipanggil dengan cursor timestamp+id dari batch pertama.
        if (url.includes('since=2026-08-05T09%3A01%3A00.000Z%7C2000')) return jsonResponse(batch2);
        return jsonResponse(batch1);
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await syncNow();
    expect(res.ok).toBe(true);
    expect(res.message).toContain('2 perubahan');

    const pulls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/pull'));
    expect(pulls.length).toBe(2);

    const inB = await db.products.filter((p) => p.syncId === '22222222-2222-4222-8222-222222222222').first();
    expect(inB?.name).toBe('Produk Batch 2');

    const meta = await db.syncMeta.get(1);
    expect(meta?.lastPullCursor).toBe('2026-08-05T09:04:00.000Z|2001');
  });

  it('syncNow kedua memakai cursor tersimpan (tidak menarik ulang dari awal)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        return jsonResponse({ accepted: [], count: 0, serverTime: '2026-08-05T10:00:00.000Z' });
      }
      if (url.includes('/api/sync/pull')) {
        return jsonResponse({
          records: [],
          tombstones: [],
          serverTime: '2026-08-05T10:00:01.000Z',
          cursor: '2026-08-05T10:00:00.000Z|7',
          hasMore: false,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res1 = await syncNow();
    expect(res1.ok).toBe(true);

    const res2 = await syncNow();
    expect(res2.ok).toBe(true);

    const pulls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/pull'));
    // Sync kedua harus memakai cursor timestamp+id, bukan since epoch.
    const sinceParams = pulls.map((c) => String(c[0])).map((u) => new URL(u).searchParams.get('since'));
    expect(sinceParams[1]).toBe('2026-08-05T10:00:00.000Z|7');
  });

  it('update record existing setelah cursor tetap ditarik pada sync berikutnya', async () => {
    let phase = 0;
    const syncId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/push')) {
        return jsonResponse({ accepted: [], count: 0, serverTime: '2026-08-05T11:00:00.000Z' });
      }
      if (url.includes('/api/sync/pull')) {
        if (phase === 0) {
          phase++;
          return jsonResponse({
            records: [{
              table: 'products',
              syncId,
              data: { name: 'Versi 1', sku: 'UPDATE-1', categoryId: 1, price: 1000, hpp: 500, stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T11:00:00.000Z' },
              updatedAt: '2026-08-05T11:00:00.000Z',
            }],
            tombstones: [],
            serverTime: '2026-08-05T11:00:01.000Z',
            cursor: '2026-08-05T11:00:00.000Z|10',
            hasMore: false,
          });
        }
        return jsonResponse({
          records: [{
            table: 'products',
            syncId,
            data: { name: 'Versi 2', sku: 'UPDATE-1', categoryId: 1, price: 2000, hpp: 500, stock: 1, unit: 'pcs', isDeleted: 0, deletedAt: null, createdAt: '2026-08-05T11:00:00.000Z' },
            updatedAt: '2026-08-05T11:05:00.000Z',
          }],
          tombstones: [],
          serverTime: '2026-08-05T11:05:01.000Z',
          cursor: '2026-08-05T11:05:00.000Z|10',
          hasMore: false,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect((await syncNow()).ok).toBe(true);
    expect((await db.products.filter((p) => p.syncId === syncId).first())?.name).toBe('Versi 1');
    expect((await syncNow()).ok).toBe(true);
    expect((await db.products.filter((p) => p.syncId === syncId).first())?.name).toBe('Versi 2');
  });
});
