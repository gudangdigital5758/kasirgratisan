

const SYNC_UNAVAILABLE_MESSAGE =
  'Sinkronisasi lintas perangkat belum tersedia. Gunakan backup cloud untuk pemulihan data.';

/**
 * Cross-device sync remains disabled until the Worker durably persists records,
 * supports pull, and defines conflict handling. Keeping this as a no-op avoids
 * marking local records synced when no server copy exists.
 */
export function triggerBackgroundSync(): void {
  // Intentionally empty. Cloud backup is the supported recovery path for now.
}

/**
 * Preserve the public result shape for callers while explicitly refusing to
 * upload data to the metadata-only sync endpoint.
 */
export async function pushSyncData(_storeId: string): Promise<{ success: boolean; message: string }> {
  return { success: false, message: SYNC_UNAVAILABLE_MESSAGE };
}

export { SYNC_UNAVAILABLE_MESSAGE };
