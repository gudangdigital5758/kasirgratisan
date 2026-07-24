/**
 * Mirror of Worker voucher pricing (computeEffect) — jaga kontraktual diskon.
 * Logic production: workers/api/src/lib/vouchers.ts
 */

type VoucherType = 'percent' | 'free_days' | 'lifetime';

function computeEffect(voucher: { type: VoucherType; value: number }, listPrice: number) {
  const amountBefore = Math.max(0, Math.floor(listPrice));
  if (voucher.type === 'lifetime') {
    return { amountAfter: 0, isLifetime: true, grantDays: null as number | null };
  }
  if (voucher.type === 'free_days') {
    return {
      amountAfter: 0,
      isLifetime: false,
      grantDays: Math.max(1, Math.floor(voucher.value)),
    };
  }
  const pct = Math.min(100, Math.max(1, Math.floor(voucher.value)));
  return {
    amountAfter: Math.floor((amountBefore * (100 - pct)) / 100),
    isLifetime: false,
    grantDays: 30,
  };
}

describe('voucher pricing (cloud)', () => {
  it('percent 50 on 25000 → 12500', () => {
    const e = computeEffect({ type: 'percent', value: 50 }, 25_000);
    expect(e.amountAfter).toBe(12_500);
    expect(e.grantDays).toBe(30);
  });

  it('percent 100 → amount 0, still 30-day grant', () => {
    const e = computeEffect({ type: 'percent', value: 100 }, 25_000);
    expect(e.amountAfter).toBe(0);
    expect(e.grantDays).toBe(30);
  });

  it('free_days → amount 0 + N days', () => {
    const e = computeEffect({ type: 'free_days', value: 14 }, 25_000);
    expect(e.amountAfter).toBe(0);
    expect(e.grantDays).toBe(14);
  });

  it('lifetime → amount 0 + isLifetime', () => {
    const e = computeEffect({ type: 'lifetime', value: 0 }, 25_000);
    expect(e.amountAfter).toBe(0);
    expect(e.isLifetime).toBe(true);
  });
});
