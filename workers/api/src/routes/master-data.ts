/**
 * Profitku API — Master Data Online (/api/products, /api/suppliers)
 * CRUD produk & supplier di sync_records (LWW pull ke perangkat).
 * Stok produk TIDAK diedit langsung — lewat /api/finance/stock atau kasir.
 * Akses: menu 'products' (produk) / 'suppliers' (supplier).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireActiveSubscription, requireMenu, requireUser } from './helpers';
import { sbGet, sbPatch, sbPost, SupabaseError } from '../lib/supabase';
import { writeEvent } from '../lib/admin';

const masterRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = { id: string; sync_id: string; data: Record<string, unknown>; server_updated_at: string };

const actorName = (c: AppContext, userId: string) =>
  userId.startsWith('team:') ? userId : c.get('userEmail') || 'owner';

async function guardStore(c: AppContext, storeId: string, menuKey: string): Promise<Response | null> {
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const menuGuard = await requireMenu(c, storeId, menuKey);
  if (menuGuard) return menuGuard;
  return null;
}

/** SKU unik (exact match — sama dgn index Dexie offline). */
async function skuTaken(c: AppContext, storeId: string, sku: string, exceptSyncId?: string): Promise<boolean> {
  const rows = await sbGet<{ sync_id: string }[]>(
    c.env,
    `sync_records?store_id=eq.${storeId}&table_name=eq.products&deleted=eq.false&data->>sku=eq.${encodeURIComponent(sku)}&select=sync_id&limit=1`,
  ).catch(() => [] as { sync_id: string }[]);
  if (!rows || rows.length === 0) return false;
  return exceptSyncId ? rows[0].sync_id !== exceptSyncId : true;
}

// === Produk ===

masterRoutes.get('/products', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 50;
  const q = String(c.req.query('q') ?? '').trim().slice(0, 60);
  const search = q
    ? `&or=(data->>name.ilike.*${encodeURIComponent(q)}*,data->>sku.ilike.*${encodeURIComponent(q)}*,data->>barcode.ilike.*${encodeURIComponent(q)}*)`
    : '';
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.products&deleted=eq.false${search}&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
    );
    const products = (rows ?? []).filter((r) => String(r.data?.isDeleted ?? 0) !== '1');
    return c.json({
      products: products.map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[products list]', err);
    return c.json({ error: 'Gagal memuat produk' }, 500);
  }
});

masterRoutes.post('/products', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    name?: string;
    sku?: string;
    price?: number;
    hpp?: number;
    unit?: string;
    trackStock?: boolean;
    description?: string;
    barcode?: string;
    categorySyncId?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;

  const name = String(body.name ?? '').trim().slice(0, 120);
  const sku = String(body.sku ?? '').trim().slice(0, 60);
  const price = Number(body.price);
  const hpp = Number(body.hpp);
  const unit = String(body.unit ?? '').trim().slice(0, 20) || 'pcs';
  if (!name) return c.json({ error: 'Nama produk wajib' }, 400);
  if (!sku) return c.json({ error: 'SKU wajib & unik' }, 400);
  if (!Number.isFinite(price) || price < 0) return c.json({ error: 'Harga jual tidak valid' }, 400);
  if (!Number.isFinite(hpp) || hpp < 0) return c.json({ error: 'Harga pokok tidak valid' }, 400);
  const categorySyncId = body.categorySyncId && UUID_RE.test(body.categorySyncId) ? body.categorySyncId : null;
  const iso = new Date().toISOString();
  const syncId = crypto.randomUUID();
  try {
    if (await skuTaken(c, storeId, sku)) {
      return c.json({ error: `SKU "${sku}" sudah dipakai produk lain` }, 409);
    }
    await sbPost(c.env, 'sync_records', {
      store_id: storeId,
      table_name: 'products',
      sync_id: syncId,
      data: {
        name,
        sku,
        categoryId: null,
        categorySyncId,
        price,
        hpp,
        stock: 0,
        trackStock: body.trackStock !== false,
        unit,
        description: String(body.description ?? '').trim().slice(0, 500),
        barcode: String(body.barcode ?? '').trim().slice(0, 60) || null,
        photo: null,
        attributes: {},
        createdAt: iso,
        updatedAt: iso,
        isDeleted: 0,
        deletedAt: null,
        createdBy: null,
        createdByName: actorName(c, userId),
      },
      deleted: false,
      server_updated_at: iso,
      client_updated_at: iso,
    });
    await writeEvent(c.env, {
      type: 'online_product_create',
      message: `Produk baru: ${name} (${sku})`,
      actorUserId: userId,
      payload: { storeId },
    }).catch(() => undefined);
    return c.json({ ok: true, syncId });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[products create]', err);
    return c.json({ error: 'Gagal menyimpan produk' }, 500);
  }
});
masterRoutes.patch('/products/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const syncId = c.req.param('syncId') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    name?: string;
    sku?: string;
    price?: number;
    hpp?: number;
    unit?: string;
    trackStock?: boolean;
    description?: string;
    barcode?: string;
    categorySyncId?: string | null;
    photo?: string | null;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.products&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Produk tidak ditemukan' }, 404);
    const patch: Record<string, unknown> = {};
    if (body.categorySyncId !== undefined) {
      patch['categorySyncId'] = body.categorySyncId && UUID_RE.test(body.categorySyncId) ? body.categorySyncId : null;
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 120);
      if (!name) return c.json({ error: 'Nama produk wajib' }, 400);
      patch['name'] = name;
    }
    if (body.sku !== undefined) {
      const sku = String(body.sku).trim().slice(0, 60);
      if (!sku) return c.json({ error: 'SKU wajib & unik' }, 400);
      if (await skuTaken(c, storeId, sku, syncId)) {
        return c.json({ error: `SKU "${sku}" sudah dipakai produk lain` }, 409);
      }
      patch['sku'] = sku;
    }
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) return c.json({ error: 'Harga jual tidak valid' }, 400);
      patch['price'] = price;
    }
    if (body.hpp !== undefined) {
      const hpp = Number(body.hpp);
      if (!Number.isFinite(hpp) || hpp < 0) return c.json({ error: 'Harga pokok tidak valid' }, 400);
      patch['hpp'] = hpp;
    }
    if (body.unit !== undefined) {
      patch['unit'] = String(body.unit).trim().slice(0, 20) || 'pcs';
    }
    if (body.trackStock !== undefined) patch['trackStock'] = body.trackStock !== false;
    if (body.description !== undefined) {
      patch['description'] = String(body.description).trim().slice(0, 500);
    }
    if (body.barcode !== undefined) {
      patch['barcode'] = String(body.barcode).trim().slice(0, 60) || null;
    }
    if (body.photo !== undefined) {
      const photo = body.photo === null ? null : String(body.photo);
      if (photo && !photo.startsWith('data:image/')) {
        return c.json({ error: 'Foto harus berupa data URL gambar' }, 400);
      }
      if (photo && photo.length > 550_000) {
        return c.json({ error: 'Foto terlalu besar (maks ±400 KB setelah kompresi)' }, 400);
      }
      patch['photo'] = photo;
    }
    if (Object.keys(patch).length === 0) return c.json({ ok: true });
    const iso = new Date().toISOString();
    patch['updatedAt'] = iso;
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, ...patch },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[products patch]', err);
    return c.json({ error: 'Gagal menyimpan produk' }, 500);
  }
});

masterRoutes.delete('/products/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const syncId = c.req.param('syncId') ?? '';
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.products&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Produk tidak ditemukan' }, 404);
    const iso = new Date().toISOString();
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, isDeleted: 1, deletedAt: iso, updatedAt: iso },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[products delete]', err);
    return c.json({ error: 'Gagal menghapus produk' }, 500);
  }
});
// === Supplier ===

masterRoutes.get('/suppliers', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId, 'suppliers');
  if (guard) return guard;
  const limitRaw = Number(c.req.query('limit') ?? '');
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 50;
  const q = String(c.req.query('q') ?? '').trim().slice(0, 60);
  const search = q ? `&data->>name.ilike.*${encodeURIComponent(q)}*` : '';
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.suppliers&deleted=eq.false${search}&order=server_updated_at.desc&limit=${limit}&select=id,sync_id,data,server_updated_at`,
    );
    const suppliers = (rows ?? []).filter((r) => String(r.data?.isDeleted ?? 0) !== '1');
    return c.json({
      suppliers: suppliers.map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[suppliers list]', err);
    return c.json({ error: 'Gagal memuat supplier' }, 500);
  }
});

masterRoutes.post('/suppliers', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    name?: string;
    phone?: string;
    address?: string;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'suppliers');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const name = String(body.name ?? '').trim().slice(0, 120);
  if (!name) return c.json({ error: 'Nama supplier wajib' }, 400);
  const iso = new Date().toISOString();
  const syncId = crypto.randomUUID();
  try {
    await sbPost(c.env, 'sync_records', {
      store_id: storeId,
      table_name: 'suppliers',
      sync_id: syncId,
      data: {
        name,
        phone: String(body.phone ?? '').trim().slice(0, 40),
        address: String(body.address ?? '').trim().slice(0, 200),
        notes: String(body.notes ?? '').trim().slice(0, 300),
        createdAt: iso,
        isDeleted: 0,
        deletedAt: null,
        updatedAt: iso,
        createdByName: actorName(c, userId),
      },
      deleted: false,
      server_updated_at: iso,
      client_updated_at: iso,
    });
    await writeEvent(c.env, {
      type: 'online_supplier_create',
      message: `Supplier baru: ${name}`,
      actorUserId: userId,
      payload: { storeId },
    }).catch(() => undefined);
    return c.json({ ok: true, syncId });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[suppliers create]', err);
    return c.json({ error: 'Gagal menyimpan supplier' }, 500);
  }
});
masterRoutes.patch('/suppliers/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const syncId = c.req.param('syncId') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as {
    storeId?: string;
    name?: string;
    phone?: string;
    address?: string;
    notes?: string;
  };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'suppliers');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.suppliers&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Supplier tidak ditemukan' }, 404);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 120);
      if (!name) return c.json({ error: 'Nama supplier wajib' }, 400);
      patch['name'] = name;
    }
    if (body.phone !== undefined) patch['phone'] = String(body.phone).trim().slice(0, 40);
    if (body.address !== undefined) patch['address'] = String(body.address).trim().slice(0, 200);
    if (body.notes !== undefined) patch['notes'] = String(body.notes).trim().slice(0, 300);
    if (Object.keys(patch).length === 0) return c.json({ ok: true });
    const iso = new Date().toISOString();
    patch['updatedAt'] = iso;
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, ...patch },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[suppliers patch]', err);
    return c.json({ error: 'Gagal menyimpan supplier' }, 500);
  }
});

masterRoutes.delete('/suppliers/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const syncId = c.req.param('syncId') ?? '';
  const guard = await guardStore(c, storeId, 'suppliers');
  if (guard) return guard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.suppliers&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Supplier tidak ditemukan' }, 404);
    const iso = new Date().toISOString();
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, isDeleted: 1, deletedAt: iso, updatedAt: iso },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[suppliers delete]', err);
    return c.json({ error: 'Gagal menghapus supplier' }, 500);
  }
});

// === Kategori produk (menu 'products') ===

masterRoutes.get('/categories', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.categories&deleted=eq.false&order=server_updated_at.desc&limit=100&select=id,sync_id,data,server_updated_at`,
    );
    const categories = (rows ?? []).filter((r) => String(r.data?.isDeleted ?? 0) !== '1');
    return c.json({
      categories: categories.map((r) => ({ syncId: r.sync_id, data: r.data, serverUpdatedAt: r.server_updated_at })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[categories list]', err);
    return c.json({ error: 'Gagal memuat kategori' }, 500);
  }
});

masterRoutes.post('/categories', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { storeId?: string; name?: string; color?: string };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  const subGuard = await requireActiveSubscription(c, storeId);
  if (subGuard) return subGuard;
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) return c.json({ error: 'Nama kategori wajib' }, 400);
  const iso = new Date().toISOString();
  const syncId = crypto.randomUUID();
  const palette = ['#0067fd', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#64748b'];
  try {
    await sbPost(c.env, 'sync_records', {
      store_id: storeId,
      table_name: 'categories',
      sync_id: syncId,
      data: {
        name,
        color: String(body.color ?? '').trim().slice(0, 9) || palette[syncId.charCodeAt(0) % palette.length],
        icon: '',
        createdAt: iso,
        isDeleted: 0,
        deletedAt: null,
        updatedAt: iso,
      },
      deleted: false,
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true, syncId });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[categories create]', err);
    return c.json({ error: 'Gagal menyimpan kategori' }, 500);
  }
});

masterRoutes.patch('/categories/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const syncId = c.req.param('syncId') ?? '';
  const body = (await c.req.json().catch(() => ({}))) as { storeId?: string; name?: string; color?: string };
  const storeId = String(body.storeId ?? '').trim();
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.categories&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Kategori tidak ditemukan' }, 404);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 60);
      if (!name) return c.json({ error: 'Nama kategori wajib' }, 400);
      patch['name'] = name;
    }
    if (body.color !== undefined) patch['color'] = String(body.color).trim().slice(0, 9);
    if (Object.keys(patch).length === 0) return c.json({ ok: true });
    const iso = new Date().toISOString();
    patch['updatedAt'] = iso;
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, ...patch },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[categories patch]', err);
    return c.json({ error: 'Gagal menyimpan kategori' }, 500);
  }
});

masterRoutes.delete('/categories/:syncId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.query('storeId') ?? '';
  const syncId = c.req.param('syncId') ?? '';
  const guard = await guardStore(c, storeId, 'products');
  if (guard) return guard;
  if (!UUID_RE.test(syncId)) return c.json({ error: 'syncId tidak valid' }, 400);
  try {
    const rows = await sbGet<Row[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.categories&sync_id=eq.${syncId}&select=id,sync_id,data,server_updated_at&limit=1`,
    );
    const row = rows?.[0];
    if (!row) return c.json({ error: 'Kategori tidak ditemukan' }, 404);
    const used = await sbGet<{ sync_id: string }[]>(
      c.env,
      `sync_records?store_id=eq.${storeId}&table_name=eq.products&deleted=eq.false&data->>categorySyncId=eq.${syncId}&select=sync_id&limit=1`,
    ).catch(() => [] as { sync_id: string }[]);
    if (used && used.length > 0) {
      return c.json({ error: 'Kategori masih dipakai produk — pindahkan produknya dulu' }, 409);
    }
    const iso = new Date().toISOString();
    await sbPatch(c.env, `sync_records?id=eq.${row.id}`, {
      data: { ...row.data, isDeleted: 1, deletedAt: iso, updatedAt: iso },
      server_updated_at: iso,
      client_updated_at: iso,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[categories delete]', err);
    return c.json({ error: 'Gagal menghapus kategori' }, 500);
  }
});

export default masterRoutes;


