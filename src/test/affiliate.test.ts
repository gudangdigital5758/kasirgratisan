import { describe, it, expect, beforeEach } from 'vitest';
import {
  looksLikeAffiliateCode,
  getAffiliateRef,
  setAffiliateRef,
  clearAffiliateRef,
} from '@/lib/affiliate';

describe('affiliate ref helpers', () => {
  beforeEach(() => clearAffiliateRef());

  it('validates referral code format (4-24 chars, tidak diawali -/_)', () => {
    expect(looksLikeAffiliateCode('AF72KQ9Z')).toBe(true);
    expect(looksLikeAffiliateCode('af-72kq9z')).toBe(true);
    expect(looksLikeAffiliateCode('AF72_KQ9')).toBe(true);
    expect(looksLikeAffiliateCode('ABC')).toBe(false);
    expect(looksLikeAffiliateCode('-ABC12')).toBe(false);
    expect(looksLikeAffiliateCode('_ABC12')).toBe(false);
    expect(looksLikeAffiliateCode('')).toBe(false);
    expect(looksLikeAffiliateCode('A'.repeat(30))).toBe(false);
  });

  it('round-trips ref via localStorage dengan kode dinormalisasi uppercase', () => {
    setAffiliateRef({ code: 'af72kq9z', name: 'Budi', capturedAt: '2026-08-10T00:00:00.000Z' });
    const ref = getAffiliateRef();
    expect(ref?.code).toBe('AF72KQ9Z');
    expect(ref?.name).toBe('Budi');
  });

  it('returns null ketika tidak ada ref tersimpan', () => {
    expect(getAffiliateRef()).toBeNull();
  });
});