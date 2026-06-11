/**
 * Thin client untuk FreeKasir Cloud API (backup + subscription).
 *
 * Token Google ID (JWT) di-inject lewat getter yang didaftarkan oleh
 * use-cloud-auth, supaya call site tidak perlu mengoper token manual.
 */

const BASE_URL = (import.meta.env.VITE_AUTH_API_URL ?? 'http://localhost:3210').replace(/\/$/, '');

let tokenGetter: () => string | null = () => null;
export function setCloudTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}

// === Types ===
export interface Plan {
  id: string;
  name: string;
  storageLimitMb: number;
  price: number;
}

export interface StorageUsage {
  usedBytes?: number;
  usedMb: number;
  limitMb: number;
  remainingMb: number;
}

export interface Subscription {
  id: string;
  planId: string;
  plan: Plan;
  startDate: string;
  endDate: string;
  status: string; // ACTIVE | EXPIRED | ...
  hasActiveSubscription: boolean;
}

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  planId: string | null;
  storageLimitMb: number;
  createdAt: string;
}

export interface CloudBackup {
  id: string;
  userId?: string;
  fileName: string;
  fileKey?: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  user: CloudUser;
  subscription: Subscription | null;
  storageUsage: StorageUsage;
  backups: CloudBackup[];
}

export interface Pagination {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface PageParams {
  page?: number;
  limit?: number;
}

function buildPageQuery(params?: PageParams): string {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// Fallback pagination bila server (versi lama) tidak mengembalikan blok pagination.
function fallbackPagination<T>(items: T[], params?: PageParams): Pagination {
  const limit = params?.limit ?? items.length;
  return { page: params?.page ?? 1, limit, totalItems: items.length, totalPages: 1, hasMore: false };
}

export interface CheckoutResult {
  message: string;
  paymentLink: string;
  transaction: { id: string; status: string; planId: string; amount: number };
}

export interface VerifyResult {
  message: string;
  transaction: { id: string; status: string };
}

export interface PaymentTransaction {
  id: string;
  userId?: string;
  planId: string;
  amount: number;
  status: string; // PENDING | COMPLETED | FAILED | ...
  paymentGatewayRef?: string;
  createdAt: string;
  updatedAt: string;
  plan?: Plan;
}

// === Core fetch ===
class CloudApiError extends Error {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  const token = tokenGetter();
  if (!token) throw new CloudApiError('Belum login Google', 401, null);
  return { Authorization: `Bearer ${token}` };
}

async function parseError(res: Response): Promise<never> {
  let body: unknown = null;
  let message = `Permintaan gagal (${res.status})`;
  try {
    body = await res.json();
    if (body && typeof body === 'object' && 'error' in body) {
      message = String((body as { error: unknown }).error);
    }
  } catch {
    /* non-JSON error body */
  }
  throw new CloudApiError(message, res.status, body);
}

// === Endpoints ===

/** Daftar paket langganan (publik, tanpa auth). */
export async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch(`${BASE_URL}/api/plans`);
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.plans ?? [];
}

/** Profil user + status langganan + kuota + daftar backup. */
export async function fetchProfile(): Promise<UserProfile> {
  const res = await fetch(`${BASE_URL}/api/user/profile`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function listBackups(params?: PageParams): Promise<Paginated<CloudBackup>> {
  const res = await fetch(`${BASE_URL}/api/backups${buildPageQuery(params)}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  const items: CloudBackup[] = data.backups ?? [];
  return { items, pagination: data.pagination ?? fallbackPagination(items, params) };
}

/** Upload satu file JSON backup (multipart). */
export async function uploadBackup(jsonString: string, fileName: string): Promise<CloudBackup> {
  const form = new FormData();
  const blob = new Blob([jsonString], { type: 'application/json' });
  form.append('file', blob, fileName);
  const res = await fetch(`${BASE_URL}/api/backups`, {
    method: 'POST',
    headers: authHeaders(), // jangan set Content-Type — biarkan browser set boundary
    body: form,
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.backup;
}

/** Unduh isi backup (JSON) untuk restore. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function downloadBackup(id: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/backups/${id}/download`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function deleteBackup(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/backups/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
}

export async function checkoutPlan(planId: string, opts?: { mobile?: string; redirectURL?: string }): Promise<CheckoutResult> {
  const res = await fetch(`${BASE_URL}/api/payments/checkout`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, ...opts }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function verifyPayment(transactionId: string): Promise<VerifyResult> {
  const res = await fetch(`${BASE_URL}/api/payments/verify/${transactionId}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Riwayat transaksi pembelian/langganan user (paginated). */
export async function fetchPaymentHistory(params?: PageParams): Promise<Paginated<PaymentTransaction>> {
  const res = await fetch(`${BASE_URL}/api/payments/history${buildPageQuery(params)}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  const items: PaymentTransaction[] = data.history ?? [];
  return { items, pagination: data.pagination ?? fallbackPagination(items, params) };
}

export { CloudApiError };
