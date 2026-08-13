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

type MemberRow = {
  id: string;
  store_id: string;
  user_id: string | null;
  role: string;
  invite_email: string | null;
  invite_state: string;
  pin_hash: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = { id: string; email: string | null; name: string | null; picture: string | null };

/** Verifikasi kepemilikan store. Return error Response atau null. */
async function requireOwner(c: AppContext, storeId: string, userId: string): Promise<Response | null> {
  const owned = await sbGet<{ id: string }[]>(
    c.env,
    `stores?id=eq.${storeId}&user_id=eq.${userId}&select=id&limit=1`,
  );
  if (!owned || owned.length === 0) {
    return c.json({ error: 'Toko tidak ditemukan atau bukan milik Anda' }, 404);
  }
  return null;
}

function memberJson(m: MemberRow, profile?: ProfileRow | null) {
  return {
    id: m.id,
    storeId: m.store_id,
    userId: m.user_id,
    role: m.role,
    email: profile?.email ?? m.invite_email,
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

  const owned = await requireOwner(c, storeId, userId);
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
  const ownerGuard = await requireOwner(c, storeId, userId);
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
  const ownerGuard = await requireOwner(c, storeId, userId);
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
  const ownerGuard = await requireOwner(c, storeId, userId);
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

/** Set / ganti PIN anggota (owner only). */
teamRoutes.post('/stores/:id/team/:memberId/pin', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;
  const storeId = c.req.param('id') ?? '';
  const memberId = c.req.param('memberId') ?? '';
  if (!UUID_RE.test(storeId) || !UUID_RE.test(memberId)) return c.json({ error: 'id tidak valid' }, 400);
  const ownerGuard = await requireOwner(c, storeId, userId);
  if (ownerGuard) return ownerGuard;

  const body = (await c.req.json().catch(() => ({}))) as { pin?: string };
  const pin = String(body.pin ?? '').trim();
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);

  try {
    const hash = await sha256Hex(`${pin}:${memberId}`);
    const rows = await sbPatch<MemberRow[]>(
      c.env,
      `cloud_team_members?id=eq.${memberId}&store_id=eq.${storeId}`,
      { pin_hash: hash },
    );
    if (!rows[0]) return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    return c.json({ ok: true, role: rows[0].role });
  } catch (err) {
    if (err instanceof SupabaseError) return c.json({ error: String(err.message) }, 400);
    console.error('[team pin]', err);
    return c.json({ error: 'Gagal menyimpan PIN' }, 500);
  }
});

/** Verifikasi login cloud anggota (dipakai aplikasi kasir). Rate-limited. */
teamRoutes.post('/stores/:id/team/verify', async (c: AppContext) => {
  const storeId = c.req.param('id') ?? '';
  if (!UUID_RE.test(storeId)) return c.json({ error: 'storeId tidak valid' }, 400);

  const { allowed, retryAfterSeconds } = rateLimit(`team-verify:${storeId}:${c.req.header('cf-connecting-ip') ?? '?'}`, 10, 60_000);
  if (!allowed) {
    return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.` }, 429);
  }

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; pin?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const pin = String(body.pin ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Email tidak valid' }, 400);
  if (!PIN_RE.test(pin)) return c.json({ error: 'PIN harus 4-6 digit angka' }, 400);

  try {
    const rows = await sbGet<MemberRow[]>(
      c.env,
      `cloud_team_members?store_id=eq.${storeId}&invite_state=eq.active&or=(${encodeURIComponent(`user_id=null,invite_email=eq.${email}`)})&select=*&limit=10`,
    );
    // cari member yang email-nya cocok (user_id → join profile, atau invite_email)
    let member: MemberRow | null = null;
    for (const m of rows ?? []) {
      if (m.invite_email === email) {
        member = m;
        break;
      }
      if (m.user_id) {
        const prof = await sbGet<ProfileRow[]>(
          c.env,
          `profiles?id=eq.${m.user_id}&select=email&limit=1`,
        );
        if (prof[0]?.email === email) {
          member = m;
          break;
        }
      }
    }
    if (!member || !member.pin_hash) return c.json({ error: 'Email atau PIN salah' }, 401);

    const hash = await sha256Hex(`${pin}:${member.id}`);
    if (hash !== member.pin_hash) return c.json({ error: 'Email atau PIN salah' }, 401);

    const prof = member.user_id
      ? (await sbGet<ProfileRow[]>(c.env, `profiles?id=eq.${member.user_id}&select=name,picture&limit=1`))[0] ?? null
      : null;
    return c.json({
      ok: true,
      member: {
        email,
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

export default teamRoutes;
