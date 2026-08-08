import { API_URL } from './config';
import { supabase } from './supabase';

export type AdminMe = {
  userId: string;
  email: string;
  role: string;
  canWrite: boolean;
  canMutateBilling: boolean;
};

type AuthAdapter = {
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  onUnauthorized: () => Promise<void>;
};

type RequestOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

const browserAuth: AuthAdapter = {
  async getToken(forceRefresh) {
    if (!supabase) return null;
    const result = forceRefresh
      ? await supabase.auth.refreshSession()
      : await supabase.auth.getSession();
    return result.data.session?.access_token ?? null;
  },
  async onUnauthorized() {
    await supabase?.auth.signOut({ scope: 'local' });
  },
};

export function createAdminRequest(auth: AuthAdapter, options: RequestOptions = {}) {
  const baseUrl = options.baseUrl ?? API_URL;
  const fetcher = options.fetcher ?? fetch;

  return async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await auth.getToken(!retry);
    const headers = new Headers(init.headers || {});
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetcher(`${baseUrl}${path}`, { ...init, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok && res.status === 401 && retry) {
      return request<T>(path, init, false);
    }
    if (!res.ok && res.status === 401) {
      await auth.onUnauthorized();
    }

    if (!res.ok) {
      const msg = (data as { error?: string }).error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  };
}

export const request = createAdminRequest(browserAuth);

export const adminApi = {
  me: () => request<AdminMe>('/admin/api/me'),

  overview: () =>
    request<{
      members: number;
      activeSubscriptions: number;
      completedPaymentsSample: number;
      revenueCompletedSampleIdr: number;
      backupsLast24h: number;
      backupBytesLast24h: number;
      mrrApproxIdr: number;
      planPriceIdr: number;
      generatedAt: string;
    }>('/admin/api/overview'),

  members: (q?: string) =>
    request<{ members: MemberRow[] }>(
      `/admin/api/members?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),

  member: (id: string) => request<MemberDetail>(`/admin/api/members/${id}`),

  extend: (id: string, days: number, reason: string) =>
    request<{ ok: boolean }>(`/admin/api/members/${id}/extend-subscription`, {
      method: 'POST',
      body: JSON.stringify({ days, reason }),
    }),

  payments: () => request<{ payments: PaymentRow[] }>('/admin/api/payments?limit=50'),

  events: (since?: string) =>
    request<{
      events: EventRow[];
      notifications: NotifRow[];
      audits: AuditRow[];
      polledAt: string;
      warning?: string;
    }>(`/admin/api/events?limit=40${since ? `&since=${encodeURIComponent(since)}` : ''}`),

  settings: () =>
    request<{
      settings: Record<string, unknown>;
      health: Record<string, unknown>;
      secretsNote: string;
      capabilities: {
        canWritePlatformSettings: boolean;
        canWriteAppSettings: boolean;
      };
    }>('/admin/api/settings'),

  appSetting: (key: string) =>
    request<{ key: string; value: unknown; updatedAt: string }>(
      `/api/app-settings/${encodeURIComponent(key)}`,
    ),

  patchSettings: (body: Record<string, unknown>) =>
    request<{ ok: boolean; updated: string[] }>('/admin/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updateAppSetting: (key: string, value: unknown) =>
    request<{
      ok: boolean;
      setting: { key: string; value: unknown; updatedAt: string };
    }>(`/admin/api/app-settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  vouchers: () => request<{ vouchers: VoucherRow[] }>('/admin/api/vouchers'),

  voucher: (id: string) =>
    request<{
      voucher: VoucherRow;
      redemptions: Array<Record<string, unknown>>;
    }>(`/admin/api/vouchers/${id}`),

  createVoucher: (body: {
    code: string;
    type: 'percent' | 'free_days' | 'lifetime';
    value: number;
    planId?: string | null;
    maxRedemptions?: number | null;
    maxPerUser?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    isActive?: boolean;
    note?: string | null;
  }) =>
    request<{ ok: boolean; voucher: VoucherRow }>('/admin/api/vouchers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchVoucher: (
    id: string,
    body: {
      isActive?: boolean;
      maxRedemptions?: number | null;
      maxPerUser?: number;
      startsAt?: string | null;
      endsAt?: string | null;
      note?: string | null;
    },
  ) =>
    request<{ ok: boolean; voucher: VoucherRow }>(`/admin/api/vouchers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** hard jika 0 klaim; soft (is_active=false) jika ada klaim. force=true → hard + cascade. */
  deleteVoucher: (id: string, opts?: { force?: boolean }) =>
    request<{
      ok: boolean;
      mode: 'hard' | 'soft';
      message?: string;
      redemptionCount?: number;
      voucher?: VoucherRow;
    }>(`/admin/api/vouchers/${id}${opts?.force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),

  // --- Affiliate ---

  affiliateSettings: () =>
    request<{ settings: AffiliateSettings }>('/admin/api/affiliates/settings'),

  patchAffiliateSettings: (body: Partial<AffiliateSettings>) =>
    request<{ ok: boolean; settings: AffiliateSettings }>('/admin/api/affiliates/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  affiliates: () =>
    request<{ affiliates: AffiliateRow[] }>('/admin/api/affiliates'),

  affiliate: (id: string) =>
    request<{ affiliate: AffiliateRow; commissions: AffiliateCommission[] }>(
      `/admin/api/affiliates/${id}`,
    ),

  createAffiliate: (body: {
    code?: string;
    name: string;
    userId?: string;
    userEmail?: string;
    referredByCode?: string;
    payoutNote?: string;
    bankName?: string;
    bankAccountNo?: string;
    bankAccountName?: string;
  }) =>
    request<{ ok: boolean; affiliate: AffiliateRow }>('/admin/api/affiliates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchAffiliate: (
    id: string,
    body: {
      name?: string;
      payoutNote?: string | null;
      bankName?: string | null;
      bankAccountNo?: string | null;
      bankAccountName?: string | null;
      isActive?: boolean;
    },
  ) =>
    request<{ ok: boolean; affiliate: AffiliateRow }>(`/admin/api/affiliates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  markAffiliatePaid: (id: string) =>
    request<{ ok: boolean; updated: number }>(`/admin/api/affiliates/${id}/mark-paid`, {
      method: 'POST',
    }),
};

export type AffiliateSettings = {
  enabled: boolean;
  /** Legacy: komisi tier tunggal (backward compat). */
  commission_percent: number;
  /** Komisi per tier (1..5), persen dari amount. */
  tiers: number[];
  attribution_days: number;
  min_amount_idr: number;
};

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  userId: string | null;
  referredBy: string | null;
  referredByCode?: string | null;
  payoutNote: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: {
    referrals: number;
    referredUsers: number;
    totalCommissionIdr: number;
    earnedCommissionIdr: number;
    paidCommissionIdr: number;
  };
};

export type AffiliateCommission = {
  id: string;
  affiliateId: string;
  paymentId: string;
  userId: string;
  amountPaid: number;
  ratePercent: number;
  commissionIdr: number;
  tier: number;
  status: 'earned' | 'paid' | 'void' | string;
  paidAt: string | null;
  createdAt: string;
};

export type VoucherRow = {
  id: string;
  code: string;
  type: string;
  value: number;
  plan_id: string | null;
  max_redemptions: number | null;
  max_per_user: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
  redemptionCount?: number;
};

export type MemberRow = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  createdAt: string;
  subscription: null | {
    status: string;
    planId: string;
    currentPeriodEnd: string;
    active: boolean;
  };
};

export type MemberDetail = {
  profile: {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    picture: string | null;
    createdAt: string;
  };
  subscriptions: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  backups: Record<string, unknown>[];
  stores: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
};

export type PaymentRow = {
  id: string;
  user_id: string;
  plan_id: string;
  amount: number;
  status: string;
  provider: string | null;
  created_at: string;
};

export type EventRow = {
  id: string;
  type: string;
  message?: string;
  level?: string;
  created_at: string;
  subject_user_id?: string;
  actor_user_id?: string;
};

export type NotifRow = {
  id: string;
  channel: string;
  template: string;
  status: string;
  recipient: string;
  created_at: string;
};

export type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
};
