/**
 * Profitku Admin API — kelola staff admin (admin_users).
 * Hanya superadmin yang boleh menambah/mengubah staff.
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAdmin, writeAudit, writeEvent, type AdminRole } from '../lib/admin';
import { sbGet, sbPatch, sbPost } from '../lib/supabase';

type Variables = {
  userId: string | null;
  userEmail: string | null;
  bearer: string | null;
};

const ROLES: AdminRole[] = ['superadmin', 'support', 'finance', 'readonly'];

const adminUsers = new Hono<{ Bindings: Env; Variables: Variables }>();

// === Daftar staff ===
adminUsers.get('/admin-users', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;

  try {
    type Row = {
      user_id: string;
      role: string;
      is_active: boolean;
      created_at: string;
    };
    const rows = await sbGet<Row[]>(
      c.env,
      'admin_users?select=user_id,role,is_active,created_at&order=created_at.desc&limit=500',
    );
    const userIds = rows.map((r) => r.user_id).filter(Boolean);
    let emailById = new Map<string, { email: string | null; name: string | null }>();
    if (userIds.length > 0) {
      try {
        const profs = await sbGet<{ id: string; email: string | null; name: string | null }[]>(
          c.env,
          `profiles?id=in.(${userIds.join(',')})&select=id,email,name`,
        );
        emailById = new Map(profs.map((p) => [p.id, { email: p.email, name: p.name }]));
      } catch {
        /* email/name optional */
      }
    }

    return c.json({
      admins: rows.map((r) => ({
        userId: r.user_id,
        email: emailById.get(r.user_id)?.email ?? null,
        name: emailById.get(r.user_id)?.name ?? null,
        role: r.role,
        isActive: r.is_active,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[admin users list]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal memuat staff admin' }, 500);
  }
});

// === Tambah staff baru (email harus sudah pernah login) ===
adminUsers.post('/admin-users', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (a.role !== 'superadmin') {
    return c.json({ error: 'Hanya superadmin yang boleh menambah staff admin' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    role?: string;
    isActive?: boolean;
  };
  const email = (body.email || '').trim().toLowerCase();
  const role = body.role as AdminRole;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Email tidak valid' }, 400);
  }
  if (!ROLES.includes(role)) {
    return c.json({ error: `Role harus salah satu dari: ${ROLES.join(', ')}` }, 400);
  }

  try {
    // Staff harus sudah pernah login (punya baris profiles).
    const profs = await sbGet<{ id: string; email: string | null }[]>(
      c.env,
      `profiles?email=ilike.${encodeURIComponent(email)}&select=id,email&limit=1`,
    );
    const profile = profs[0];
    if (!profile?.id) {
      return c.json(
        { error: `Tidak ada akun dengan email ${email}. User harus login (Google) dulu sekali sebelum dijadikan admin.` },
        404,
      );
    }

    const created = await sbPost<{ user_id: string; role: string; is_active: boolean }[]>(
      c.env,
      'admin_users',
      {
        user_id: profile.id,
        role,
        is_active: body.isActive !== false,
      },
    );
    const row = created[0];

    await writeAudit(c.env, a, 'admin_users.create', 'admin_users', profile.id, {
      email,
      role,
      isActive: row?.is_active ?? body.isActive !== false,
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    });
    await writeEvent(c.env, {
      type: 'admin.admin_users.create',
      message: `Admin ${a.email} menambahkan staff ${email} (${role})`,
      actorUserId: a.userId,
      subjectUserId: profile.id,
      payload: { email, role, actorEmail: a.email },
    });

    return c.json({
      ok: true,
      admin: {
        userId: profile.id,
        email,
        role,
        isActive: row?.is_active ?? true,
      },
    });
  } catch (err) {
    console.error('[admin users create]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal menambah staff admin' }, 500);
  }
});


// === Ubah role / status staff ===
adminUsers.patch('/admin-users/:id', async (c) => {
  const a = await requireAdmin(c);
  if (a instanceof Response) return a;
  if (a.role !== 'superadmin') {
    return c.json({ error: 'Hanya superadmin yang boleh mengubah staff admin' }, 403);
  }

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { role?: string; isActive?: boolean };
  if (body.role !== undefined && !ROLES.includes(body.role as AdminRole)) {
    return c.json({ error: `Role harus salah satu dari: ${ROLES.join(', ')}` }, 400);
  }

  try {
    const patch: Record<string, unknown> = {};
    if (body.role !== undefined) patch.role = body.role;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'Tidak ada field yang diubah' }, 400);
    }
    const updated = await sbPatch<{ user_id: string; role: string; is_active: boolean }[]>(
      c.env,
      `admin_users?user_id=eq.${id}`,
      patch,
    );
    if (!updated[0]) {
      return c.json({ error: 'Staff admin tidak ditemukan' }, 404);
    }

    await writeAudit(c.env, a, 'admin_users.update', 'admin_users', id, {
      patch,
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    });
    await writeEvent(c.env, {
      type: 'admin.admin_users.update',
      message: `Admin ${a.email} memperbarui staff ${id} (${JSON.stringify(patch)})`,
      actorUserId: a.userId,
      subjectUserId: id,
      payload: { patch, actorEmail: a.email },
    });

    return c.json({
      ok: true,
      admin: {
        userId: id,
        role: updated[0].role,
        isActive: updated[0].is_active,
      },
    });
  } catch (err) {
    console.error('[admin users update]', err);
    return c.json({ error: err instanceof Error ? err.message : 'Gagal mengubah staff admin' }, 500);
  }
});

export default adminUsers;

