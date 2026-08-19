/**
 * Helper sesi tim cloud (SEC-005): hash SHA-256 hex untuk token sesi.
 * Token sesi TIDAK disimpan plaintext — hanya hash yang disimpan di DB.
 */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
