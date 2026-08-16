import { describe, expect, it } from 'vitest';
import { hashPin, PBKDF2_ITERATIONS, verifyPin } from '../src/lib/pin';

async function legacySha256(pin: string, memberId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pin}:${memberId}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('hashPin / verifyPin (PBKDF2 — SEC-001)', () => {
  it('roundtrip: hash lalu verify ok, format pbkdf2$iter$salt$hash', async () => {
    const hash = await hashPin('1234', 'member-1');
    expect(hash.startsWith(`pbkdf2$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(hash.split('$')).toHaveLength(4);
    expect(await verifyPin('1234', 'member-1', hash)).toEqual({ ok: true, needsRehash: false });
  });

  it('PIN salah ditolak; member lain ditolak (domain binding)', async () => {
    const hash = await hashPin('123456', 'member-1');
    expect((await verifyPin('654321', 'member-1', hash)).ok).toBe(false);
    expect((await verifyPin('123456', 'member-2', hash)).ok).toBe(false);
  });

  it('hash acak per pemanggilan (salt berbeda) — tidak bisa rainbow', async () => {
    const a = await hashPin('1111', 'm1');
    const b = await hashPin('1111', 'm1');
    expect(a).not.toBe(b);
  });

  it('legacy sha256 (format lama) diverifikasi + needsRehash=true', async () => {
    const legacy = await legacySha256('4321', 'member-1');
    expect(legacy).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPin('4321', 'member-1', legacy)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPin('0000', 'member-1', legacy)).toEqual({ ok: false, needsRehash: false });
  });

  it('stored null / format rusak / iterasi absurd ditolak', async () => {
    expect(await verifyPin('1234', 'm1', null)).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPin('1234', 'm1', 'garbage')).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPin('1234', 'm1', 'pbkdf2$abc')).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPin('1234', 'm1', 'pbkdf2$1$c2FsdA$c2FsdA')).toEqual({ ok: false, needsRehash: false });
  });
});
