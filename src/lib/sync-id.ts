/**
 * Helper pembuat syncId (Phase A sync). UUID v4 via crypto.randomUUID dengan
 * fallback untuk environment yang tidak mendukungnya.
 */
export function newSyncId(): string {
  try {
    const v = crypto.randomUUID();
    if (v) return v;
  } catch {
    /* fallback di bawah */
  }
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
