import { describe, expect, it } from 'vitest';
import { sanitizeSyncData } from '../../workers/api/src/lib/sync-schema';

describe('Worker sync field allowlist', () => {
  it('mempertahankan dual-FK dan membuang field unknown', () => {
    const data = sanitizeSyncData('transactionItems', {
      transactionId: 1,
      transactionSyncId: '11111111-1111-4111-8111-111111111111',
      productId: 2,
      productSyncId: '22222222-2222-4222-8222-222222222222',
      productName: 'Produk',
      pinHash: 'must-not-pass',
      unknownField: 'must-not-pass',
    });

    expect(data.transactionSyncId).toBe('11111111-1111-4111-8111-111111111111');
    expect(data.productSyncId).toBe('22222222-2222-4222-8222-222222222222');
    expect(data.pinHash).toBeUndefined();
    expect(data.unknownField).toBeUndefined();
  });

  it('membuang pinHash users tetapi mempertahankan profil non-credential', () => {
    const data = sanitizeSyncData('users', {
      username: 'kasir',
      name: 'Kasir',
      pinHash: 'secret',
      permissions: ['create_transaction'],
    });

    expect(data.username).toBe('kasir');
    expect(data.permissions).toEqual(['create_transaction']);
    expect(data.pinHash).toBeUndefined();
  });
});
