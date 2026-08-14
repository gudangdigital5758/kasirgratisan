/**
 * Profitku API — Tim & Roles Cloud (/api/stores/:id/team*)
 * Owner = stores.user_id (implied). Anggota = cloud_team_members.
 * v1: kelola anggota + role dari dashboard; POS enforcement menyusul
 * (butuh keputusan model auth: PIN via dashboard / email OTP).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser } from './helpers';
import { rateLimit } from '../lib/rate-limit';
import { sbGet, sbPost, sbPatch, sbDelete, SupabaseError } from '../lib/supabase';

const teamRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^(admin|kasir|salesman|kepala_gudang|karyawan)$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const STORE_CODE_RE = /^[A-HJ-NP-Z2-9]{4,8}$/;

type MemberRow = {
  id: string;
  store_id: string;
  user_id: string | null;
  role: string;
  invite_email: string | null;
  invite_state: string;
  username: string | null;
  name: string | null;
  pin_hash: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = { id: string; email: string | null; name: string | null; picture: string | null };

/** Verifikasi owner ATAU admin toko (kelola tim + set login). */
export async function requireManager(c: AppContext, storeId: string, userId: string): Promise<Response | null> {
  const owned = await sbGet<{ id: string }[]>(
    c.env,
    `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id&limit=1`,
  );
  if (owned && owned.length > 0) return null;
  const admin = await sbGet<{ id: string }[]>(
    c.env,
    `cloud_team_members?store_id=eq.${storeId}&user_id=eq.${userId}&role=eq.admin&invite_state=eq.active&select=id&limit=1`,
  );
  if (admin && admin.length > 0) return null;
  return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
}

function memberJson(m: MemberRow, profile?: ProfileRow | null) {
  return {
    id: m.id,
    storeId: m.store_id,
    userId: m.user_id,
    role: m.role,
    email: profile?.email ?? m.invite_email,
    username: m.username,
    name: profile?.name ?? null,
    picture: profile?.picture ?? null,
    inviteState: m.invite_state,
    createdAt: m.created_at,
  };
}

/** Daftar anggota tim (owner atau anggota yang login). */
teamRoutes.get('/stores/:id/team', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);

  const owned = await requireManager(c, storeId, userId);
  const isOwner = owned === null;
  if (!isOwner) {
    // Bukan owner — cek apakah anggota aktif.
    const mine = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}&user_id=eq.${userId}&invite_state=eq.active&select=*&limit=1`,
    );
    if (!mine || mine.length === 0) return c.json({ error: 'Forbidden' }, 403);
  }

  try {
    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}&order=created_at.asc&select=*`,
    );
    const members = rows ?? [];
    const uniq = [...new Set([userId, ...members.map((m) => m.user_id).filter((x): x is string => !!x)])];
    const profiles = uniq.length
      ? await sbGet<ProfileRow[]>(
          c.env,
          `profiles?${uniq.map((u) => `id=eq.${u}`).join('&')}&select=id,email,name,picture`,
        ).catch(() => [] as ProfileRow[])
      : ([] as ProfileRow[]);
    const profById = new Map(profiles.map((p) => [p.id, p]));

    const ownerProfile = profById.get(userId) ?? null;
    const list = members.map((m) => memberJson(m, m.user_id ? profById.get(m.user_id) ?? null : null));
    return c.json({
      owner: {
        userId,
        role: 'owner',
        email: ownerProfile?.email ?? null,
        name: ownerProfile?.name ?? null,
      },
      members: list,
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team list]', err);
    return c.json({ error: 'Gagal memuat anggota tim' }, 500);
  }
});

/** Undang anggota (owner only). Email terdaftar → aktif; belum → pending. */
teamRoutes.post('/stores/:id/team/invite', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);
  const ownerGuard = await requireManager(c, storeId, userId);
  if (ownerGuard) return ownerGuard;

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = String(body.role ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Email tidak valid' }, 400);
  if (!ROLE_RE.test(role)) return c.json({ error: 'Role tidak valid (admin/kasir/salesman/kepala_gudang/karyawan)' }, 400);

  try {
    const profile = await sbGet<ProfileRow[]>(
      c.env,
      `profiles?email=eq.${encodeURIComponent(email)}&select=id,email,name,picture&limit=1`,
    );
    const existing = profile[0] ?? null;
    const dup = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}${existing ? `&user_id=eq.${existing.id}` : `&invite_email=eq.${encodeURIComponent(email)}`}&select=id&limit=1`,
    );
    if (dup && dup.length > 0) return c.json({ error: 'Email ini sudah menjadi anggota tim' }, 409);

    const inserted = await sbPost<MemberRow[]>(c.env, 'cloud_team_members', {
      store_id: storeId,
      user_id: existing?.id ?? null,
      role,
      invite_email: existing ? null : email,
      invite_state: existing ? 'active' : 'pending',
    });
    const m = inserted[0];
    return c.json({ member: memberJson(m, existing) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team invite]', err);
    return c.json({ error: 'Gagal mengundang anggota' }, 500);
  }
});

/** Ubah role anggota (owner only). */
teamRoutes.patch('/stores/:id/team/:memberId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  const memberId = c.req.param('memberId') ?? '';
  if (!UUID_RE.test(storeId) || !UUID_RE.test(memberId)) return c.json({ error: 'id tidak valid' }, 400);
  const ownerGuard = await requireManager(c, storeId, userId);
  if (ownerGuard) return ownerGuard;

  const body = (await c.req.json().catch(() => ({}))) as { role?: string };
  const role = String(body.role ?? '').trim();
  if (!ROLE_RE.test(role)) return c.json({ error: 'Role tidak valid' }, 400);

  try {
    const rows = await sbPatch<MemberRow[]>(
      c.env,
      `cloud_team_members?id=eq.${memberId}&store_id=eq.${storeId}`,
      { role },
    );
    const m = rows[0];
    if (!m) return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    return c.json({ member: memberJson(m) });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team role]', err);
    return c.json({ error: 'Gagal mengubah role' }, 500);
  }
});

/** Hapus anggota (owner only). */
teamRoutes.delete('/stores/:id/team/:memberId', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  const memberId = c.req.param('memberId') ?? '';
  if (!UUID_RE.test(storeId) || !UUID_RE.test(memberId)) return c.json({ error: 'id tidak valid' }, 400);
  const ownerGuard = await requireManager(c, storeId, userId);
  if (ownerGuard) return ownerGuard;

  try {
    await sbDelete(c.env, `cloud_team_members?id=eq.${memberId}&store_id=eq.${storeId}`);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team remove]', err);
    return c.json({ error: 'Gagal menghapus anggota' }, 500);
  }
});

// === C4: PIN login cloud (keputusan 2026-08-13 — PIN di-set owner via dashboard) ===

const PIN_RE = /^\d{4,6}$/;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Set / ganti username + PIN login cloud (owner atau admin). */
teamRoutes.post('/stores/:id/team/:memberId/credentials', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  const memberId = c.req.param('memberId') ?? '';
  if (!UUID_RE.test(storeId) || !UUID_RE.test(memberId)) return c.json({ error: 'id tidak valid' }, 400);
  const managerGuard = await requireManager(c, storeId, userId);
  if (managerGuard) return managerGuard;
  const body = (await c.req.json().catch(() => ({}))) as { storeCode?: string; username?: string; pin?: string };
  const username = String(body.username ?? '').trim().toLowerCase();
  const pin = String(body.pin ?? '').trim();
  if (!USERNAME_RE.test(username)) return c.json({ error: 'Username 3-20 karakter (huruf/angka/underscore/titik)' }, 400);
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);
  try {
    const dup = await sbGet<{ id: string }[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}&username=eq.${encodeURIComponent(username)}&id=neq.${memberId}&select=id&limit=1`,
    );
    if (dup && dup.length > 0) return c.json({ error: 'Username sudah dipakai anggota lain' }, 409);
    const hash = await sha256Hex(`${pin}:${memberId}`);
    const rows = await sbPatch<MemberRow[]>(
      c.env,
      `cloud_team_members?id=eq.${memberId}&store_id=eq.${storeId}` ,
      { username, pin_hash: hash },
    );
    if (!rows[0]) return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    return c.json({ ok: true, role: rows[0].role });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team credentials]', err);
    return c.json({ error: 'Gagal menyimpan username & PIN' }, 500);
  }
});

/** Verifikasi login cloud anggota (POS: username + PIN, scope per toko). Rate-limited. */
teamRoutes.post('/stores/:id/team/verify', async (c: AppContext) => {
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);

  const { allowed, retryAfterSeconds } = rateLimit(`team-verify:${storeId}:${c.req.header('cf-connecting-ip') ?? '?'}`, 10, 60_000);
  if (!allowed) {
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.` }, 429);
  }

  const body = (await c.req.json().catch(() => ({}))) as { storeCode?: string; username?: string; pin?: string };
  const username = String(body.username ?? '').trim().toLowerCase();
  const pin = String(body.pin ?? '').trim();
  if (!USERNAME_RE.test(username)) return c.json({ error: 'Username tidak valid' }, 400);
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);

  try {
    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}&invite_state=eq.active&username=eq.${encodeURIComponent(username)}&select=*&limit=1` ,
    );
    const member = rows?.[0] ?? null;
    if (!member || !member.pin_hash) return c.json({ error: 'Username atau PIN salah' }, 401);

    const hash = await sha256Hex(`${pin}:${member.id}`);
    if (hash !== member.pin_hash) return c.json({ error: 'Username atau PIN salah' }, 401);

    const prof = member.user_id
      ? (await sbGet<ProfileRow[]>(c.env, `profiles?id=eq.${member.user_id}&select=name,picture&limit=1`))[0] ?? null
      : null;
    return c.json({
      ok: true,
      member: {
        username,
        name: prof?.name ?? null,
        role: member.role,
        picture: prof?.picture ?? null,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team verify]', err);
    return c.json({ error: 'Gagal memverifikasi login' }, 500);
  }
});

// === Login tim (dashboard): username + PIN global -> sesi token ===

teamRoutes.post('/team/login', async (c: AppContext) => {
  const { allowed, retryAfterSeconds } = rateLimit(`team-login:${c.req.header('cf-connecting-ip') ?? '?'}`, 10, 60_000);
  if (!allowed) {
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.` }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { storeCode?: string; username?: string; pin?: string };
  const username = String(body.username ?? '').trim().toLowerCase();
  const pin = String(body.pin ?? '').trim();
  if (!USERNAME_RE.test(username)) return c.json({ error: 'Username tidak valid' }, 400);
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);

  try {
    let scopedStore: { id: string; name: string } | null = null;
    if (body.storeCode) {
      const code = String(body.storeCode).trim().toUpperCase();
      const st = await sbGet<{ id: string; name: string }[]>(
        c.env,
        `stores?store_code=eq.${encodeURIComponent(code)}&select=id,name&limit=1`,
      );
      scopedStore = st?.[0] ?? null;
      if (!scopedStore) return c.json({ error: 'ID Toko tidak ditemukan' }, 404);
    }
    const rows = await sbGet<MemberRow[]>(
      c.env,
      scopedStore
        ? `cloud_team_members?store_id=eq.${scopedStore.id}&invite_state=eq.active&username=eq.${encodeURIComponent(username)}&select=*&limit=1`
        : `cloud_team_members?username=eq.${encodeURIComponent(username)}&invite_state=eq.active&select=*&limit=20` ,
    );
    const members = rows ?? [];
    const matches: MemberRow[] = [];
    for (const m of members) {
      if (!m.pin_hash) continue;
      const hash = await sha256Hex(`${pin}:${m.id}`);
      if (hash === m.pin_hash) matches.push(m);
    }
    if (matches.length === 0) return c.json({ error: 'Username atau PIN salah' }, 401);

    const storeIds = [...new Set(matches.map((m) => m.store_id))];
    const stores = await sbGet<{ id: string; name: string; store_code: string | null }[]>(
      c.env,
      `stores?${storeIds.map((s) => `id=eq.${s}`).join('&')}&select=id,name,store_code` ,
    ).catch(() => [] as { id: string; name: string; store_code: string | null }[]);
    const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));
    const storeCodeById = new Map((stores ?? []).map((s) => [s.id, s.store_code]));
    const memberships = matches.map((m) => ({
      storeId: m.store_id,
      storeName: storeNameById.get(m.store_id) ?? 'Toko',
      storeCode: storeCodeById.get(m.store_id) ?? null,
      role: m.role,
      username,
    }));

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await sbPost(c.env, 'cloud_team_sessions', {
      member_id: matches[0].id,
      token,
      expires_at: expiresAt,
    });
    return c.json({ ok: true, token, expiresAt, memberships });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team login]', err);
    return c.json({ error: 'Gagal login' }, 500);
  }
});

/** Info keanggotaan tim untuk user yang login (Supabase atau token tim). */
teamRoutes.get('/team/me', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  try {
    let memberIds: string[] = [];
    if (userId.startsWith('team:')) {
      memberIds = [userId.slice(5)];
    } else {
      const mine = await sbGet<MemberRow[]>(
        c.env,
        `cloud_team_members?user_id=eq.${userId}&invite_state=eq.active&select=*&limit=20` ,
      );
      memberIds = (mine ?? []).map((m) => m.id);
    }
    if (memberIds.length === 0) return c.json({ memberships: [] });

    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?${memberIds.map((i) => `id=eq.${i}`).join('&')}&invite_state=eq.active&select=*&limit=20` ,
    );
    const members = rows ?? [];
    const storeIds = [...new Set(members.map((m) => m.store_id))];
    const stores = await sbGet<{ id: string; name: string; store_code: string | null }[]>(
      c.env,
      `stores?${storeIds.map((s) => `id=eq.${s}`).join('&')}&select=id,name,store_code` ,
    ).catch(() => [] as { id: string; name: string; store_code: string | null }[]);
    const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));
    const storeCodeById = new Map((stores ?? []).map((s) => [s.id, s.store_code]));
    return c.json({
      memberships: members.map((m) => ({
        storeId: m.store_id,
        storeName: storeNameById.get(m.store_id) ?? 'Toko',
        role: m.role,
        username: m.username,
      })),
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team me]', err);
    return c.json({ error: 'Gagal memuat keanggotaan' }, 500);
  }
});

// === Member-centric (multi-toko): kelola anggota lintas toko owner ===
// Identitas anggota = email (jika ada) ATAU username. Email & nama opsional.

async function memberEmail(c: AppContext, m: MemberRow): Promise<string | null> {
  if (m.invite_email) return m.invite_email.toLowerCase();
  if (m.user_id) {
    const prof = await sbGet<ProfileRow[]>(c.env, `profiles?id=eq.${m.user_id}&select=email&limit=1`);
    if (prof[0]?.email) return prof[0].email.toLowerCase();
  }
  return null;
}

async function memberName(c: AppContext, m: MemberRow): Promise<string | null> {
  if (m.name) return m.name;
  if (m.user_id) {
    const prof = await sbGet<ProfileRow[]>(c.env, `profiles?id=eq.${m.user_id}&select=name&limit=1`);
    return prof[0]?.name ?? null;
  }
  return null;
}

async function findMemberRowsByIdentity(
  c: AppContext,
  email: string | null,
  username: string | null,
  storeIds: string[],
): Promise<MemberRow[]> {
  if (storeIds.length === 0) return [];
  const rows = await sbGet<MemberRow[]>(
    c.env,
    `cloud_team_members?or=(${storeIds.map((s) => `store_id.eq.${s}`).join(',')})&select=*&limit=200`,
  );
  const out: MemberRow[] = [];
  for (const m of rows ?? []) {
    if (username && m.username === username) { out.push(m); continue; }
    if (email) {
      const em = await memberEmail(c, m);
      if (em === email) out.push(m);
    }
  }
  return out;
}

/** Daftar anggota semua toko owner, dikelompokkan per email/username. */
teamRoutes.get('/team/members', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  try {
    const stores = await sbGet<{ id: string; name: string; store_code: string | null }[]>(
      c.env,
      `stores?user_id=eq.${userId}&select=id,name,store_code`,
    );
    const storeIds = (stores ?? []).map((s) => s.id);
    if (storeIds.length === 0) return c.json({ members: [] });
    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?or=(${storeIds.map((s) => `store_id.eq.${s}`).join(',')})&select=*&limit=200`,
    );
    const storeById = new Map((stores ?? []).map((s) => [s.id, s]));
    type Entry = {
      key: string;
      email: string | null;
      username: string | null;
      name: string | null;
      stores: { storeId: string; storeName: string; storeCode: string | null; role: string; memberId: string }[];
    };
    const byKey = new Map<string, Entry>();
    for (const m of rows ?? []) {
      const em = await memberEmail(c, m);
      const key = em ?? m.username;
      if (!key) continue;
      const store = storeById.get(m.store_id);
      const entry = byKey.get(key) ?? { key, email: em, username: null, name: null, stores: [] };
      entry.username = entry.username ?? m.username;
      entry.email = entry.email ?? em;
      entry.name = entry.name ?? (await memberName(c, m));
      entry.stores.push({
        storeId: m.store_id,
        storeName: store?.name ?? 'Toko',
        storeCode: store?.store_code ?? null,
        role: m.role,
        memberId: m.id,
      });
      byKey.set(key, entry);
    }
    return c.json({ members: [...byKey.values()] });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team members]', err);
    return c.json({ error: 'Gagal memuat anggota' }, 500);
  }
});

/** Tambah/ubah anggota multi-toko (owner). Email & nama opsional; username wajib. */
teamRoutes.post('/team/members', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    username?: string;
    pin?: string;
    name?: string;
    assignments?: { storeId: string; role: string }[];
  };
  const email = String(body.email ?? '').trim().toLowerCase() || null;
  const name = String(body.name ?? '').trim().slice(0, 80) || null;
  const assignments = (body.assignments ?? []).filter((a) => a && a.storeId && ROLE_RE.test(a.role ?? ''));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Email tidak valid' }, 400);
  if (assignments.length === 0) return c.json({ error: 'Pilih minimal satu toko' }, 400);
  const username = body.username ? String(body.username).trim().toLowerCase() : null;
  const pin = body.pin ? String(body.pin).trim() : null;
  if (!username || !USERNAME_RE.test(username)) return c.json({ error: 'Username wajib, 3-20 karakter (huruf/angka/underscore/titik)' }, 400);
  if (pin && !PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);
  try {
    const storeIds = [...new Set(assignments.map((a) => a.storeId))];
    const owned = await sbGet<{ id: string }[]>(
      c.env,
      `stores?user_id=eq.${userId}&or=(${storeIds.map((s) => `id.eq.${s}`).join(',')})&select=id`,
    );
    const ownedSet = new Set((owned ?? []).map((s) => s.id));
    if (storeIds.some((s) => !ownedSet.has(s))) return c.json({ error: 'Salah satu toko bukan milik Anda' }, 403);

    const existing = await findMemberRowsByIdentity(c, email, username, storeIds);
    const existingByStore = new Map(existing.map((m) => [m.store_id, m]));

    for (const a of assignments) {
      const row = existingByStore.get(a.storeId) ?? null;
      if (row) {
        const patch: Record<string, unknown> = { role: a.role };
        if (username) patch['username'] = username;
        if (pin) patch['pin_hash'] = await sha256Hex(`${pin}:${row.id}`);
        if (name) patch['name'] = name;
        await sbPatch(c.env, `cloud_team_members?id=eq.${row.id}`, patch);
      } else {
        const dup = await sbGet<{ id: string }[]>(
          c.env,
          `cloud_team_members?store_id=eq.${a.storeId}&username=eq.${encodeURIComponent(username)}&select=id&limit=1`,
        );
        if (dup && dup.length > 0) {
          return c.json({ error: `Username sudah dipakai anggota lain di salah satu toko` }, 409);
        }
        const inserted = await sbPost<MemberRow[]>(c.env, 'cloud_team_members', {
          store_id: a.storeId,
          user_id: null,
          role: a.role,
          invite_email: email,
          invite_state: 'active',
          username,
          name,
          pin_hash: null,
        });
        if (pin) {
          await sbPatch(c.env, `cloud_team_members?id=eq.${inserted[0].id}`, { pin_hash: await sha256Hex(`${pin}:${inserted[0].id}`) });
        }
      }
    }
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team members post]', err);
    return c.json({ error: 'Gagal menyimpan anggota' }, 500);
  }
});

/** Set username/PIN/nama untuk SEMUA toko anggota (owner). Identifikasi via email atau username. */
teamRoutes.post('/team/credentials', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; username?: string; newUsername?: string; pin?: string; name?: string };
  const email = String(body.email ?? '').trim().toLowerCase() || null;
  const username = String(body.username ?? '').trim().toLowerCase();
  const newUsername = body.newUsername ? String(body.newUsername).trim().toLowerCase() : null;
  const pin = body.pin ? String(body.pin).trim() : null;
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) || null : undefined;
  if (!email && !username) return c.json({ error: 'Identitas anggota (email atau username) wajib' }, 400);
  if (newUsername && !USERNAME_RE.test(newUsername)) return c.json({ error: 'Username 3-20 karakter (huruf/angka/underscore/titik)' }, 400);
  if (pin && !PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);
  try {
    const stores = await sbGet<{ id: string }[]>(c.env, `stores?user_id=eq.${userId}&select=id`);
    const storeIds = (stores ?? []).map((s) => s.id);
    const rows = await findMemberRowsByIdentity(c, email, email ? null : username, storeIds);
    if (rows.length === 0) return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    const targetUsername = newUsername ?? username;
    for (const m of rows) {
      const dup = await sbGet<{ id: string }[]>(
        c.env,
        `cloud_team_members?store_id=eq.${m.store_id}&username=eq.${encodeURIComponent(targetUsername)}&id=neq.${m.id}&select=id&limit=1`,
      );
      if (dup && dup.length > 0) {
        return c.json({ error: `Username sudah dipakai anggota lain di salah satu toko` }, 409);
      }
      const patch: Record<string, unknown> = { username: targetUsername };
      if (pin) patch['pin_hash'] = await sha256Hex(`${pin}:${m.id}`);
      if (name !== undefined) patch['name'] = name;
      await sbPatch(c.env, `cloud_team_members?id=eq.${m.id}`, patch);
    }
    return c.json({ ok: true, stores: rows.length });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team credentials]', err);
    return c.json({ error: 'Gagal menyimpan login' }, 500);
  }
});

/** Hapus anggota dari SEMUA tokonya (owner). Key = email atau username. */
teamRoutes.delete('/team/members/:key', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const key = String(c.req.param('key') ?? '').trim().toLowerCase();
  const isEmail = key.includes('@');
  try {
    const stores = await sbGet<{ id: string }[]>(c.env, `stores?user_id=eq.${userId}&select=id`);
    const rows = await findMemberRowsByIdentity(c, isEmail ? key : null, isEmail ? null : key, (stores ?? []).map((s) => s.id));
    for (const m of rows) {
      await sbDelete(c.env, `cloud_team_members?id=eq.${m.id}`);
    }
    return c.json({ ok: true, removed: rows.length });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team member delete]', err);
    return c.json({ error: 'Gagal menghapus anggota' }, 500);
  }
});

/** Verifikasi login tim via ID Toko (store_code) � POS, tanpa sesi. */
teamRoutes.post('/team/verify', async (c: AppContext) => {
  const { allowed, retryAfterSeconds } = rateLimit(`team-verify:${c.req.header('cf-connecting-ip') ?? '?'}`, 10, 60_000);
  if (!allowed) {
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.` }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { storeCode?: string; username?: string; pin?: string };
  const code = String(body.storeCode ?? '').trim().toUpperCase();
  const username = String(body.username ?? '').trim().toLowerCase();
  const pin = String(body.pin ?? '').trim();
  if (!STORE_CODE_RE.test(code)) return c.json({ error: 'ID Toko tidak valid' }, 400);
  if (!USERNAME_RE.test(username)) return c.json({ error: 'Username tidak valid' }, 400);
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);
  try {
    const st = await sbGet<{ id: string; name: string }[]>(
      c.env,
      `stores?store_code=eq.${encodeURIComponent(code)}&select=id,name&limit=1`,
    );
    const store = st?.[0] ?? null;
    if (!store) return c.json({ error: 'ID Toko tidak ditemukan' }, 404);
    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${store.id}&invite_state=eq.active&username=eq.${encodeURIComponent(username)}&select=*&limit=1`,
    );
    const member = rows?.[0] ?? null;
    if (!member || !member.pin_hash) return c.json({ error: 'Username atau PIN salah' }, 401);
    const hash = await sha256Hex(`${pin}:${member.id}`);
    if (hash !== member.pin_hash) return c.json({ error: 'Username atau PIN salah' }, 401);
    const prof = member.user_id
      ? (await sbGet<ProfileRow[]>(c.env, `profiles?id=eq.${member.user_id}&select=name,picture&limit=1`))[0] ?? null
      : null;
    return c.json({
      ok: true,
      member: {
        storeCode: code,
        storeName: store.name,
        username,
        name: member.name ?? prof?.name ?? null,
        role: member.role,
        picture: prof?.picture ?? null,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team verify]', err);
    return c.json({ error: 'Gagal memverifikasi login' }, 500);
  }
});

export default teamRoutes;
