import { API_URL } from './config';

let tokenGetter: () => string | null = () => null;

export function setAdminTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenGetter();
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const adminApi = {
  me: () =>
    request<{
      userId: string;
      email: string;
      role: string;
      canWrite: boolean;
      canMutateBilling: boolean;
    }>('/admin/api/me'),

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
    }>('/admin/api/settings'),

  patchSettings: (body: Record<string, unknown>) =>
    request<{ ok: boolean; updated: string[] }>('/admin/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
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
