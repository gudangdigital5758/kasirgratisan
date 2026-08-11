/**
 * Profitku API — Profile / entitlements (/api/user/profile)
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import { requireUser } from './helpers';
import { sbGet } from '../lib/supabase';
import { sumBackupBytes } from '../lib/backups';

const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/user/profile', async (c: AppContext) => {
  const userId = requireUser(c);
  if (userId instanceof Response) return userId;

  // Default free entitlements
  const profile = {
    user: {
      id: userId,
      email: c.get('userEmail') || '',
      name: c.get('userEmail')?.split('@')[0] || 'User',
      picture: undefined as string | undefined,
      planId: null as string | null,
      storageLimitMb: 0,
      syncExpiry: null as string | null,
      maxStores: null as number | null,
      createdAt: new Date().toISOString(),
    },
    subscription: null as null | Record<string, unknown>,
    syncSubscription: null as null | Record<string, unknown>,
    storageUsage: { usedMb: 0, limitMb: 0, remainingMb: 0 },
    backups: [] as unknown[],
    stores: [] as unknown[],
  };

  try {
    if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
      type Ent = {
        user_id: string;
        email: string | null;
        name: string | null;
        picture: string | null;
        storage_limit_mb: number;
        has_sync: boolean;
        sync_expiry: string | null;
        max_stores: number | null;
        is_lifetime?: boolean | null;
      };
      const ents = await sbGet<Ent[]>(c.env, `user_entitlements?user_id=eq.${userId}&select=*`);
      const ent = ents[0];
      if (ent) {
        profile.user.email = ent.email || profile.user.email;
        profile.user.name = ent.name || profile.user.name;
        profile.user.picture = ent.picture || undefined;
        profile.user.storageLimitMb = ent.storage_limit_mb || 0;
        profile.user.syncExpiry = ent.sync_expiry;
        profile.user.maxStores = ent.max_stores;
        // Pemakaian nyata (dari metadata backups) — bukan hardcode 0.
        const usedBytes = await sumBackupBytes(c.env, String(userId)).catch(() => 0);
        const limitMb = ent.storage_limit_mb || 0;
        const usedMb = usedBytes / (1024 * 1024);
        profile.storageUsage = {
          usedMb,
          limitMb,
          remainingMb: Math.max(0, limitMb - usedMb),
        };
      }

      type SubRow = {
        id: string;
        plan_id: string;
        status: string;
        current_period_start: string;
        current_period_end: string;
        is_lifetime?: boolean;
        plans: {
          id: string;
          name: string;
          storage_limit_mb: number;
          price_idr: number;
          category: string;
          max_stores: number | null;
        } | null;
      };

      const nowIso = new Date().toISOString();
      let subs: SubRow[] = [];
      try {
        subs = await sbGet<SubRow[]>(
          c.env,
          `subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&or=(is_lifetime.eq.true,current_period_end.gt.${nowIso})&select=id,plan_id,status,current_period_start,current_period_end,is_lifetime,plans(id,name,storage_limit_mb,price_idr,category,max_stores)`,
        );
      } catch {
        subs = await sbGet<SubRow[]>(
          c.env,
          `subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&current_period_end=gt.${nowIso}&select=id,plan_id,status,current_period_start,current_period_end,plans(id,name,storage_limit_mb,price_idr,category,max_stores)`,
        );
      }

      for (const s of subs) {
        const plan = s.plans
          ? {
              id: s.plans.id,
              name: s.plans.name,
              storageLimitMb: s.plans.storage_limit_mb,
              price: s.plans.price_idr,
              category: s.plans.category,
              maxStores: s.plans.max_stores,
            }
          : null;
        const mapped = {
          id: s.id,
          planId: s.plan_id,
          plan,
          startDate: s.current_period_start,
          endDate: s.current_period_end,
          status: s.status === 'active' || s.status === 'trialing' ? 'ACTIVE' : s.status.toUpperCase(),
          hasActiveSubscription: true,
          isLifetime: !!s.is_lifetime || !!ent?.is_lifetime,
        };
        if (plan?.category === 'SYNC') profile.syncSubscription = mapped;
        else if (plan?.category === 'STORAGE') profile.subscription = mapped;
        // cloud_monthly = SYNC; juga map ke subscription generik bila kosong
        if (plan?.category === 'SYNC' && !profile.subscription) {
          profile.subscription = mapped;
        }
      }

      type BackupRow = {
        id: string;
        file_name: string;
        file_size: number;
        created_at: string;
        updated_at: string;
      };
      const backups = await sbGet<BackupRow[]>(
        c.env,
        `backups?user_id=eq.${userId}&order=created_at.desc&limit=20&select=id,file_name,file_size,created_at,updated_at`,
      );
      profile.backups = backups.map((b) => ({
        id: b.id,
        fileName: b.file_name,
        fileSize: b.file_size,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      }));

      // Per-toko: entitlement + kuota penyimpanan + pemakaian backup.
      try {
        type StoreEnt = {
          store_id: string;
          store_name: string;
          is_public: boolean;
          has_sync: boolean;
          sync_expiry: string | null;
          is_lifetime: boolean;
          storage_limit_mb: number;
          backup_bytes: number | string;
        };
        const storeEnts = await sbGet<StoreEnt[]>(
          c.env,
          `store_entitlements?user_id=eq.${userId}&select=store_id,store_name,is_public,has_sync,sync_expiry,is_lifetime,storage_limit_mb,backup_bytes`,
        );
        profile.stores = storeEnts.map((e) => {
          const backupBytes = Number(e.backup_bytes ?? 0);
          return {
            id: e.store_id,
            name: e.store_name,
            isPublic: e.is_public,
            entitlement: {
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
            },
          };
        });
      } catch (err) {
        console.warn('[profile stores]', err);
      }
    }
  } catch (err) {
    console.warn('[profile]', err);
  }

  return c.json(profile);
});

export default profileRoutes;
