/**
 * Profitku API — Stores (/api/stores, /api/stores/:id)
 * Model per-toko berbayar: semua user boleh membuat toko (unlimited);
 * langganan cloud ditentukan per toko (store_entitlements).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireSyncStore, requireUser } from './helpers';
import { sbGet, sbPost, sbPatch, sbDelete, SupabaseError } from '../lib/supabase';
import { deleteBackupObject, getBackupObject, putBackupObject } from '../lib/backups';

const storesRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Stores (minimal) ---
storesRoutes.get('/stores', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type S = {
        id: string;
        user_id: string;
        name: string;
        created_at: string;
        updated_at: string;
        is_public: boolean;
        identifier: string | null;
        store_code: string | null;
      };
      type StoreEnt = {
        store_id: string;
        has_sync: boolean;
        sync_expiry: string | null;
        is_lifetime: boolean;
        storage_limit_mb: number;
        backup_bytes: number | string;
      };
      const rows = await sbGet<S[]>(c.env, `stores?user_id=eq.${userId}&order=created_at.desc&select=*`);
      for (const s of rows) {
        if (!s.store_code) s.store_code = await ensureStoreCode(c, s.id);
      }
      const ents = await sbGet<StoreEnt[]>(
        c.env,
        `store_entitlements?user_id=eq.${userId}&select=store_id,has_sync,sync_expiry,is_lifetime,storage_limit_mb,backup_bytes`,
      ).catch(() => [] as StoreEnt[]);
      const entByStore = new Map(ents.map((e) => [e.store_id, e]));
      return c.json({
        stores: rows.map((s) => {
          const e = entByStore.get(s.id);
          const backupBytes = e ? Number(e.backup_bytes ?? 0) : 0;
          return {
            id: s.id,
            userId: s.user_id,
            name: s.name,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            isPublic: s.is_public,
            identifier: s.identifier,
            storeCode: s.store_code,
            entitlement: e
              ? {
                  hasSync: e.has_sync,
                  syncExpiry: e.sync_expiry,
                  isLifetime: e.is_lifetime,
                  storageLimitMb: e.storage_limit_mb || 0,
                  backupBytes,
                  usedMb: Number((backupBytes / (1024 * 1024)).toFixed(2)),
                  remainingMb: Math.max(
                    0,
                    Number(((e.storage_limit_mb || 0) - backupBytes / (1024 * 1024)).toFixed(2)),
                  ),
                }
              : null,
          };
        }),
      });
    }
  } catch (err) {
    console.warn('[stores]', err);
  }
  return c.json({ stores: [] });
});

storesRoutes.post('/stores', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return c.json({ error: 'Nama toko wajib' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    type S = {
      id: string;
      user_id: string;
      name: string;
      created_at: string;
      updated_at: string;
      store_code: string | null;
    };

    // Model per-toko berbayar: semua user boleh membuat toko (unlimited).
    // Langganan cloud ditentukan per toko (store_entitlements), bukan jumlah toko.
    const result = await sbPost<S[] | S>(c.env, 'rpc/create_store_with_limit', {
      p_user_id: userId,
      p_name: body.name.trim(),
      p_max_stores: null,
    });
    const s = Array.isArray(result) ? result[0] : result;
    if (!s) return c.json({ error: 'Gagal membuat toko cloud' }, 500);
    s.store_code = await ensureStoreCode(c, s.id);
    return c.json({
      store: {
        id: s.id,
        userId: s.user_id,
        name: s.name,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores create]', err);
    return c.json({ error: 'Gagal membuat toko cloud' }, 500);
  }
});

/** Update detail toko (rename + profil toko online). */
storesRoutes.put('/stores/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Nama toko wajib' }, 400);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    type S = {
      id: string;
      user_id: string;
      name: string;
      created_at: string;
      updated_at: string;
      is_public: boolean;
      identifier: string | null;
      store_code: string | null;
      logo_path: string | null;
      address1: string | null;
      address2: string | null;
      province_id: number | null;
      province_name: string | null;
      city_id: number | null;
      city_name: string | null;
      district_id: number | null;
      district_name: string | null;
      latitude: number | null;
      longitude: number | null;
      phone: string | null;
      timezone: string | null;
      operational_hours: unknown;
    };
    const patch: Record<string, unknown> = { name: String(body.name).trim() };
    // Key body = camelCase (client), key patch = snake_case (kolom DB).
    const copyStr = (k: string, dbKey: string) => {
      if (typeof body[k] === 'string' && body[k] !== '') patch[dbKey] = body[k];
      else if (body[k] === null) patch[dbKey] = null;
    };
    const copyNum = (k: string, dbKey: string) => {
      const n = Number(body[k]);
      if (Number.isFinite(n)) patch[dbKey] = n;
      else if (body[k] === null) patch[dbKey] = null;
    };
    copyStr('address1', 'address1');
    copyStr('address2', 'address2');
    copyStr('provinceName', 'province_name');
    copyStr('cityName', 'city_name');
    copyStr('districtName', 'district_name');
    copyStr('phone', 'phone');
    copyStr('timezone', 'timezone');
    copyNum('provinceId', 'province_id');
    copyNum('cityId', 'city_id');
    copyNum('districtId', 'district_id');
    copyNum('latitude', 'latitude');
    copyNum('longitude', 'longitude');
    if (body.operationalHours !== undefined) patch['operational_hours'] = body.operationalHours;
    if (body.storeCode !== undefined) {
      const code = String(body.storeCode).trim().toUpperCase();
      if (!STORE_CODE_RE.test(code)) {
        return c.json({ error: 'ID Toko 4-8 karakter huruf/angka (tanpa 0/O/1/I)' }, 400);
      }
      const dup = await sbGet<{ id: string }[]>(
        c.env,
        `stores?store_code=eq.${encodeURIComponent(code)}&id=neq.${storeId}&select=id&limit=1`,
      );
      if (dup && dup.length > 0) return c.json({ error: 'ID Toko sudah dipakai toko lain' }, 409);
      patch['store_code'] = code;
    }

    const rows = await sbPatch<S[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      patch,
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    if (!s.store_code) s.store_code = await ensureStoreCode(c, s.id);
    const apiOrigin = c.env.API_ORIGIN || 'https://api.profitku.my.id';
    return c.json({
      store: {
        id: s.id,
        userId: s.user_id,
        name: s.name,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        isPublic: s.is_public,
        identifier: s.identifier,
        storeCode: s.store_code,
        logoUrl: s.logo_path ? `${apiOrigin}/api/stores/${s.id}/logo` : null,
        address1: s.address1,
        address2: s.address2,
        provinceId: s.province_id,
        provinceName: s.province_name,
        cityId: s.city_id,
        cityName: s.city_name,
        districtId: s.district_id,
        districtName: s.district_name,
        latitude: s.latitude,
        longitude: s.longitude,
        phone: s.phone,
        timezone: s.timezone,
        operationalHours: s.operational_hours,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores update]', err);
    return c.json({ error: 'Gagal mengubah toko' }, 500);
  }
});

/** Claim subscription lama level akun ke toko cloud yang dipilih user. */
storesRoutes.post('/stores/:id/claim-legacy-subscription', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as { moveLegacyBackups?: boolean };
  try {
    const result = await sbPost<{
      claimed: boolean;
      reason?: string;
      subscriptionId?: string;
      periodEnd?: string;
      isLifetime?: boolean;
      movedBackupCount?: number;
    }>(c.env, 'rpc/claim_legacy_subscription', {
      p_user_id: userId,
      p_store_id: storeId,
      p_move_legacy_backups: body.moveLegacyBackups === true,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores claim legacy]', err);
    return c.json({ error: 'Gagal menghubungkan subscription lama ke toko' }, 500);
  }
});

/** Bind device kedua ke cloud store existing yang sudah aktif. */
storesRoutes.post('/stores/:id/bind-device', async (c: AppContext) => {
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const guard = await requireSyncStore(c, storeId);
  if (guard) return guard;

  const body = (await c.req.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceName?: string;
  };
  const deviceId = String(body.deviceId || '').trim();
  const deviceName = String(body.deviceName || '').trim().slice(0, 120);
  if (!deviceId || deviceId.length > 128) return c.json({ error: 'deviceId wajib' }, 400);

  try {
    await sbPost(c.env, 'rpc/sync_register_device', {
      p_store_id: storeId,
      p_device_id: deviceId,
      p_device_name: deviceName,
    });
    return c.json({ ok: true, storeId, deviceId, deviceName });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores bind device]', err);
    return c.json({ error: 'Gagal menghubungkan device ke toko cloud' }, 500);
  }
});

// === Toko Online (market): identifier, visibility, logo ===

const IDENTIFIER_RE = /^[a-z0-9-]{2,60}$/;

type StoreRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  is_public: boolean;
  identifier: string | null;
  store_code: string | null;
  logo_path: string | null;
  address1: string | null;
  address2: string | null;
  province_id: number | null;
  province_name: string | null;
  city_id: number | null;
  city_name: string | null;
  district_id: number | null;
  district_name: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  timezone: string | null;
  operational_hours: unknown;
};

function storeJson(c: AppContext, s: StoreRow) {
  const apiOrigin = c.env.API_ORIGIN || 'https://api.profitku.my.id';
  return {
    id: s.id,
    userId: s.user_id,
    name: s.name,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    isPublic: s.is_public,
    identifier: s.identifier,
    storeCode: s.store_code,
    logoUrl: s.logo_path ? `${apiOrigin}/api/stores/${s.id}/logo` : null,
    address1: s.address1,
    address2: s.address2,
    provinceId: s.province_id,
    provinceName: s.province_name,
    cityId: s.city_id,
    cityName: s.city_name,
    districtId: s.district_id,
    districtName: s.district_name,
    latitude: s.latitude,
    longitude: s.longitude,
    phone: s.phone,
    timezone: s.timezone,
    operationalHours: s.operational_hours,
  };
}
// === ID Toko (store_code): auto-generate, unik global ===
const STORE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STORE_CODE_RE = /^[A-HJ-NP-Z2-9]{4,8}$/;

function generateStoreCode(len = 6): string {
  const out: string[] = [];
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out.push(STORE_CODE_ALPHABET[arr[i] % STORE_CODE_ALPHABET.length]);
  return out.join('');
}

/** Pastikan toko punya store_code (auto-generate + simpan). Return code baru atau null. */
async function ensureStoreCode(c: AppContext, storeId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateStoreCode();
    const dup = await sbGet<{ id: string }[]>(
      c.env,
      `stores?store_code=eq.${code}&select=id&limit=1`,
    );
    if (!dup || dup.length === 0) {
      await sbPatch(c.env, `stores?id=eq.${storeId}`, { store_code: code });
      return code;
    }
  }
  return null;
}

/** Cek ketersediaan URL toko (slug) — global unique. */
storesRoutes.get('/stores/identifier/check', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const q = String(c.req.query('q') ?? '').trim().toLowerCase();
  if (!IDENTIFIER_RE.test(q)) return c.json({ available: false, error: 'Format URL tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    const rows = await sbGet<{ id: string }[]>(
      c.env,
      `stores?identifier=eq.${encodeURIComponent(q)}&select=id&limit=1`,
    );
    return c.json({ available: rows.length === 0 });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores identifier check]', err);
    return c.json({ error: 'Gagal mengecek URL toko' }, 500);
  }
});

/** Cek ketersediaan ID Toko (store_code) � global unique. */
storesRoutes.get('/stores/store-code/check', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const q = String(c.req.query('q') ?? '').trim().toUpperCase();
  if (!STORE_CODE_RE.test(q)) return c.json({ available: false, error: 'Format ID Toko tidak valid (4-8 huruf/angka, tanpa 0/O/1/I)' }, 400);
  const rows = await sbGet<{ id: string }[]>(
    c.env,
    `stores?store_code=eq.${encodeURIComponent(q)}&select=id&limit=1`,
  );
  return c.json({ available: rows.length === 0 });
});

/** Set / hapus identifier (slug) toko � ownership + unique. */
/** Set / hapus identifier (slug) toko — ownership + unique. */
storesRoutes.patch('/stores/:id/identifier', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { identifier?: string | null };
  const identifier = body.identifier === null || body.identifier === undefined
    ? null
    : String(body.identifier).trim().toLowerCase();
  if (identifier !== null && !IDENTIFIER_RE.test(identifier)) {
    return c.json({ error: 'Format URL tidak valid (huruf kecil, angka, strip, 2-60 karakter)' }, 400);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    if (identifier !== null) {
      const taken = await sbGet<{ id: string }[]>(
        c.env,
        `stores?identifier=eq.${encodeURIComponent(identifier)}&id=neq.${storeId}&select=id&limit=1`,
      );
      if (taken.length > 0) return c.json({ error: 'URL toko sudah digunakan toko lain' }, 409);
    }
    const rows = await sbPatch<StoreRow[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      { identifier },
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({ store: storeJson(c, s) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores identifier patch]', err);
    return c.json({ error: 'Gagal menyimpan URL toko' }, 500);
  }
});

/** Toggle visibilitas publik di market. */
storesRoutes.patch('/stores/:id/visibility', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { isPublic?: boolean };
  if (typeof body.isPublic !== 'boolean') return c.json({ error: 'isPublic wajib boolean' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    const rows = await sbPatch<StoreRow[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      { is_public: body.isPublic },
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({ store: storeJson(c, s) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores visibility]', err);
    return c.json({ error: 'Gagal mengubah visibilitas toko' }, 500);
  }
});

/** Upload logo toko (R2, ≤2MB, jpeg/png/webp). */
storesRoutes.post('/stores/:id/logo', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('logo');
  if (!file || typeof file === 'string' || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
    return c.json({ error: 'File logo wajib (field "logo")' }, 400);
  }
  const logoFile = file as unknown as { size: number; type: string; arrayBuffer: () => Promise<ArrayBuffer> };
  if (logoFile.size > 2 * 1024 * 1024) return c.json({ error: 'Ukuran logo maksimal 2 MB' }, 400);
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const ext = extMap[logoFile.type];
  if (!ext) return c.json({ error: 'Jenis file logo harus JPG/PNG/WebP' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    const key = `logos/${storeId}.${ext}`;
    await putBackupObject(c.env, key, await logoFile.arrayBuffer(), logoFile.type);
    const rows = await sbPatch<StoreRow[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      { logo_path: key },
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({ store: storeJson(c, s) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores logo upload]', err);
    return c.json({ error: 'Gagal mengunggah logo' }, 500);
  }
});

/** Hapus logo toko. */
storesRoutes.delete('/stores/:id/logo', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }
  try {
    const before = await sbGet<{ logo_path: string | null }[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}&select=logo_path&limit=1`,
    );
    const rows = await sbPatch<StoreRow[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}`,
      { logo_path: null },
    );
    const s = rows[0];
    if (!s) return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
    const oldPath = before[0]?.logo_path;
    if (oldPath?.startsWith('logos/')) await deleteBackupObject(c.env, oldPath);
    return c.json({ store: storeJson(c, s) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[stores logo delete]', err);
    return c.json({ error: 'Gagal menghapus logo' }, 500);
  }
});

/** Logo toko — PUBLIC (market storefront, tanpa auth). */
storesRoutes.get('/stores/:id/logo', async (c: AppContext) => {
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  try {
    const rows = await sbGet<{ logo_path: string | null }[]>(
      c.env,
      `stores?id=eq.${storeId}&select=logo_path&limit=1`,
    );
    const logoPath = rows[0]?.logo_path;
    if (!logoPath?.startsWith('logos/')) return c.body(null, 404);
    const obj = await getBackupObject(c.env, logoPath);
    if (!obj) return c.body(null, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[stores logo get]', err);
    return c.body(null, 404);
  }
});

/**
 * DELETE /api/stores/:id — hapus toko cloud milik user secara permanen.
 * Menghapus:
 *  - objek backup di R2 + metadata di tabel backups
 *  - logo toko di R2
 *  - baris stores (cascade: sync_records, sync_devices, sync_pull_watermarks,
 *    subscriptions.store_id). payments.store_id di-set null (riwayat keuangan &
 *    komisi affiliate tetap tersimpan).
 * Idempotent: jika toko sudah tidak ada → 200 ok.
 */
storesRoutes.delete('/stores/:id', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id');
  if (!UUID_RE.test(storeId ?? '')) return c.json({ error: 'storeId tidak valid' }, 400);
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud database belum dikonfigurasi' }, 503);
  }

  try {
    // Pastikan toko milik user ini.
    const owned = await sbGet<{ id: string }[]>(
      c.env,
      `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id`,
    );
    if (!owned[0]) return c.json({ ok: true }); // sudah tidak ada / bukan miliknya

    // 0) Hapus logo toko (R2) jika ada.
    const logo = await sbGet<{ logo_path: string | null }[]>(
      c.env,
      `stores?id=eq.${storeId}&select=logo_path&limit=1`,
    ).catch(() => [] as { logo_path: string | null }[]);
    if (logo[0]?.logo_path?.startsWith('logos/')) {
      try {
        await deleteBackupObject(c.env, logo[0].logo_path);
      } catch (e) {
        console.warn('[stores delete] logo', logo[0].logo_path, e);
      }
    }

    // 1) Hapus backup cloud toko (R2 + metadata) — data toko tutup tidak perlu disimpan.
    const backups = await sbGet<
      { id: string; file_key: string }[]
    >(c.env, `backups?store_id=eq.${storeId}&user_id=eq.${userId}&select=id,file_key`).catch(
      () => [] as { id: string; file_key: string }[],
    );
    for (const b of backups) {
      try {
        await deleteBackupObject(c.env, b.file_key);
      } catch (e) {
        console.warn('[stores delete] backup object', b.file_key, e);
      }
      try {
        await sbDelete(c.env, `backups?id=eq.${b.id}`);
      } catch (e) {
        console.warn('[stores delete] backup meta', b.id, e);
      }
    }

    // 2) Hapus baris toko (cascade sync/subscription).
    await sbDelete(c.env, `stores?id=eq.${storeId}&user_id=eq.${userId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[stores delete]', err);
    return c.json({ error: 'Gagal menghapus toko' }, 500);
  }
});

export default storesRoutes;
