/**
 * Thin client untuk Profitku Cloud API (backup + subscription).
 *
 * Token (Google ID JWT / Supabase access token) di-inject lewat getter
 * yang didaftarkan oleh use-cloud-auth, supaya call site tidak perlu
 * mengoper token manual.
 *
 * Backend target: Cloudflare Worker (`workers/api`) + Supabase.
 */

import { BRAND } from './brand';

const BASE_URL = (
  import.meta.env.VITE_AUTH_API_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8787' : BRAND.apiOrigin)
).replace(/\/$/, '');

let tokenGetter: () => string | null = () => null;
export function setCloudTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}

/** Sync token dari storage Supabase (dipakai sebelum request jika ref kosong). */
export function peekCloudToken(): string | null {
  return tokenGetter();
}

// === Types ===
export type PlanCategory = 'STORAGE' | 'SYNC';

export interface Plan {
  id: string;
  name: string;
  storageLimitMb: number;
  price: number;
  category: PlanCategory;
  maxStores: number | null;
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
  syncExpiry: string | null;
  maxStores?: number | null; // batas jumlah toko sesuai paket sync aktif
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

export interface CloudStore {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isPublic?: boolean;
  identifier?: string | null;
  address1?: string | null;
  address2?: string | null;
  provinceId?: number | null;
  provinceName?: string | null;
  cityId?: number | null;
  cityName?: string | null;
  districtId?: number | null;
  districtName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  timezone?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operationalHours?: any;
  logoUrl?: string | null;
  _count?: {
    products: number;
    storeTransactions: number;
    backups: number;
  };
}

export interface UserProfile {
  user: CloudUser;
  subscription: Subscription | null;
  syncSubscription: Subscription | null;
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

/** Upload satu file JSON backup (multipart). storeId wajib jika user punya sync subscription aktif. */
export async function uploadBackup(jsonString: string, fileName: string, storeId?: string): Promise<CloudBackup> {
  const form = new FormData();
  const blob = new Blob([jsonString], { type: 'application/json' });
  form.append('file', blob, fileName);
  if (storeId) form.append('storeId', storeId);
  const res = await fetch(`${BASE_URL}/api/backups`, {
    method: 'POST',
    headers: authHeaders(),
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

export interface GooglePlayVerifyResult {
  message: string;
  subscription: {
    planId: string;
    status: string;
    expiryDate: string;
  };
}

export async function verifyGooglePlayPurchase(
  planId: string,
  productId: string,
  purchaseToken: string,
  packageName: string
): Promise<GooglePlayVerifyResult> {
  const res = await fetch(`${BASE_URL}/api/payments/google-play/verify`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, productId, purchaseToken, packageName }),
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

// === Store Management ===

export async function fetchStores(): Promise<CloudStore[]> {
  const res = await fetch(`${BASE_URL}/api/stores`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.stores ?? [];
}

export async function createStore(name: string): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export async function renameStore(id: string, name: string): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export async function deleteStore(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
}

export interface CloudStoreUpdateInput {
  name: string;
  address1?: string | null;
  address2?: string | null;
  provinceId?: number | null;
  provinceName?: string | null;
  cityId?: number | null;
  cityName?: string | null;
  districtId?: number | null;
  districtName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  timezone?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operationalHours?: any;
}

export interface DestinationItem {
  id: number;
  name: string;
}

export async function checkIdentifierAvailability(q: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/stores/identifier/check?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return !!data.available;
}

export async function updateStoreIdentifier(id: string, identifier: string | null): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}/identifier`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export async function updateStoreVisibility(id: string, isPublic: boolean): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}/visibility`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic }),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export async function updateStoreDetails(id: string, data: CloudStoreUpdateInput): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) await parseError(res);
  const dataJson = await res.json();
  return dataJson.store;
}

export async function fetchProvinces(): Promise<DestinationItem[]> {
  const res = await fetch(`${BASE_URL}/api/destinations/provinces`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchCities(provinceId: number | string): Promise<DestinationItem[]> {
  const res = await fetch(`${BASE_URL}/api/destinations/cities/${provinceId}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchDistricts(cityId: number | string): Promise<DestinationItem[]> {
  const res = await fetch(`${BASE_URL}/api/destinations/districts/${cityId}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  const json = await res.json();
  return json.data ?? [];
}

export async function uploadStoreLogo(id: string, file: File): Promise<CloudStore> {
  const form = new FormData();
  form.append('logo', file);
  const res = await fetch(`${BASE_URL}/api/stores/${id}/logo`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export async function deleteStoreLogo(id: string): Promise<CloudStore> {
  const res = await fetch(`${BASE_URL}/api/stores/${id}/logo`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
  const data = await res.json();
  return data.store;
}

export interface SyncPayload {
  categories?: any[];
  products?: any[];
  customers?: any[];
  users?: any[];
  transactions?: any[];
  transactionItems?: any[];
  expenseCategories?: any[];
  expenses?: any[];
  debts?: any[];
  debtPayments?: any[];
  stockOpnames?: any[];
  stockOpnameItems?: any[];
}

export interface SyncResponse {
  message: string;
}

export function hasCloudToken(): boolean {
  try {
    return tokenGetter() !== null;
  } catch {
    return false;
  }
}

export async function syncStoreData(storeId: string, payload: SyncPayload): Promise<SyncResponse> {
  const res = await fetch(`${BASE_URL}/api/stores/${storeId}/sync`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export { CloudApiError };
