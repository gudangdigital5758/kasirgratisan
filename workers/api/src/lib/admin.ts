import type { Context } from 'hono';
import type { Env } from '../env';
import { sbGet, sbPost } from './supabase';

export type AdminRole = 'superadmin' | 'support' | 'finance' | 'readonly';

export type AdminContext = {
  userId: string;
  email: string;
  role: AdminRole;
};

type HonoCtx = Context<{
  Bindings: Env;
  Variables: {
    userId: string | null;
    userEmail: string | null;
    bearer: string | null;
  };
}>;

function parseAllowlist(env: Env): string[] {
  const raw = env.ADMIN_EMAILS || '';
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Cek staff: baris admin_users aktif, atau email di ADMIN_EMAILS (env). */
export async function resolveAdmin(
  env: Env,
  userId: string,
  email: string | null,
): Promise<AdminContext | null> {
  const normalized = (email || '').trim().toLowerCase();

  try {
    type Row = { user_id: string; role: string; is_active: boolean };
    const rows = await sbGet<Row[]>(
      env,
      `admin_users?user_id=eq.${userId}&is_active=eq.true&select=user_id,role,is_active&limit=1`,
    );
    if (rows[0]) {
      return {
        userId,
        email: normalized || email || '',
        role: (rows[0].role as AdminRole) || 'support',
      };
    }
  } catch {
    // table may not exist yet — fall through to env allowlist
  }

  if (normalized && parseAllowlist(env).includes(normalized)) {
    return { userId, email: normalized, role: 'superadmin' };
  }

  return null;
}

export async function requireAdmin(c: HonoCtx): Promise<AdminContext | Response> {
  const userId = c.get('userId');
  const email = c.get('userEmail');
  if (!userId) {
    return c.json({ error: 'Belum login' }, 401);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'Cloud DB belum dikonfigurasi' }, 503);
  }
  const admin = await resolveAdmin(c.env, userId, email);
  if (!admin) {
    return c.json({ error: 'Akses admin ditolak' }, 403);
  }
  return admin;
}

export function canWrite(role: AdminRole): boolean {
  return role === 'superadmin' || role === 'support' || role === 'finance';
}

export function canMutateBilling(role: AdminRole): boolean {
  return role === 'superadmin' || role === 'finance' || role === 'support';
}

export async function writeAudit(
  env: Env,
  actor: AdminContext,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Record<string, unknown>,
  ip?: string | null,
): Promise<void> {
  try {
    await sbPost(env, 'admin_audit_log', {
      actor_id: actor.userId,
      actor_email: actor.email,
      action,
      entity,
      entity_id: entityId ?? null,
      meta: meta ?? {},
      ip: ip ?? null,
    });
  } catch (err) {
    console.warn('[admin audit]', err);
  }
}

export async function writeEvent(
  env: Env,
  event: {
    level?: string;
    source?: string;
    type: string;
    message?: string;
    actorUserId?: string | null;
    subjectUserId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await sbPost(env, 'platform_events', {
      level: event.level ?? 'info',
      source: event.source ?? 'api',
      type: event.type,
      message: event.message ?? null,
      actor_user_id: event.actorUserId ?? null,
      subject_user_id: event.subjectUserId ?? null,
      payload: event.payload ?? {},
    });
  } catch (err) {
    console.warn('[platform event]', err);
  }
}
