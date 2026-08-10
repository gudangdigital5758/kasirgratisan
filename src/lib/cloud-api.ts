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

/** Resolve API base: never bake localhost into production builds. */
function resolveCloudApiBase(): string {
  const fromEnv = String(import.meta.env.VITE_AUTH_API_URL || '')
    .trim()
    .replace(/\/$/, '');
  const isLocal = (u: string) => /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(u);

  if (import.meta.env.DEV) {
    return fromEnv || 'http://127.0.0.1:8787';
  }
  // Production (vite build): ignore localhost override from local .env
  if (fromEnv && !isLocal(fromEnv)) return fromEnv;
  return BRAND.apiOrigin;
}

const BASE_URL = resolveCloudApiBase();

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

/** Durasi langganan per toko (1/6/12 bulan dengan diskon). */
export interface CloudDuration {
  months: 1 | 6 | 12;
  priceFactor: number;
  label: string;
  price: number;
}

export const CLOUD_DURATIONS: CloudDuration[] = [
  { months: 1, priceFactor: 1, label: '1 bulan', price: 25_000 },
  { months: 6, priceFactor: 5, label: '6 bulan (bayar 5)', price: 125_000 },
  { months: 12, priceFactor: 10, label: '12 bulan (bayar 10)', price: 250_000 },
];

/** Entitlement + pemakaian penyimpanan per toko cloud. */
export interface CloudStoreEntitlement {
  hasSync: boolean;
  syncExpiry: string | null;
  isLifetime: boolean;
  storageLimitMb: number;
  backupBytes: number;
  usedMb: number;
}

export interface CloudProfileStore {
  id: string;
  name: string;
  isPublic: boolean;
  entitlement: CloudStoreEntitlement;
}

export interface Subscription {
  id: string;
  planId: string;
  plan: Plan;
  startDate: string;
  endDate: string;
  status: string; // ACTIVE | EXPIRED | ...
  hasActiveSubscription: boolean;
  /** Cloud seumur hidup (voucher lifetime) */
  isLifetime?: boolean;
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
  /** Entitlement langganan per toko (model per-toko berbayar). */
  entitlement?: CloudStoreEntitlement | null;
}

export interface UserProfile {
  user: CloudUser;
  subscription: Subscription | null;
  syncSubscription: Subscription | null;
  storageUsage: StorageUsage;
  backups: CloudBackup[];
  /** Daftar toko cloud + entitlement per toko (model per-toko berbayar). */
  stores?: CloudProfileStore[];
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
  paymentLink: string | null;
  completed?: boolean;
  snapToken?: string | null;
  transaction: {
    id: string;
    status: string;
    planId: string;
    amount: number;
    provider?: string;
    voucherCode?: string | null;
  };
}

export interface VoucherPreviewResult {
  valid: boolean;
  error?: string;
  code?: string;
  voucherId?: string;
  type?: 'percent' | 'free_days' | 'lifetime';
  value?: number;
  amountBefore?: number;
  amountAfter?: number;
  discountIdr?: number;
  grantDays?: number | null;
  isLifetime?: boolean;
  message?: string;
}

export interface VerifyResult {
  message: string;
  transaction: { id: string; status: string };
}

export interface AffiliateLookupResult {
  valid: boolean;
  code?: string;
  name?: string;
  error?: string;
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

// === Sync lintas perangkat (Phase A M1) ===

export interface SyncPushItem {
  syncId: string;
  data: unknown; // record tanpa syncId/syncedAt/id (id lokal tidak pernah dikirim)
  updatedAt: string;
}

export interface SyncTombstoneItem {
  table: string;
  syncId: string;
  deletedAt: string;
}

export interface SyncPushResult {
  accepted: string[];
  count: number;
  serverTime: string;
}

export interface SyncPullRecord {
  table: string;
  syncId: string;
  data: unknown;
  updatedAt: string;
}

export interface SyncPullResult {
  records: SyncPullRecord[];
  tombstones: SyncTombstoneItem[];
  serverTime: string;
}

/** Push batch record + tombstone (LWW server-side). */
export async function syncPush(
  storeId: string,
  payload: { records: Record<string, SyncPushItem[]>; tombstones: SyncTombstoneItem[] },
  deviceId?: string,
  deviceName?: string,
): Promise<SyncPushResult> {
  const res = await fetch(`${BASE_URL}/api/sync/push`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId, ...payload, deviceId, deviceName }),
  });
  if (!res.ok) await parseError(res);
  return res.json() as Promise<SyncPushResult>;
}

/** Pull record yang berubah sejak `since` (ISO server time). */
export async function syncPull(storeId: string, since: string): Promise<SyncPullResult> {
  const qs = new URLSearchParams({ storeId, since });
  const res = await fetch(`${BASE_URL}/api/sync/pull?${qs.toString()}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json() as Promise<SyncPullResult>;
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

export async function listBackups(params?: PageParams & { storeId?: string }): Promise<Paginated<CloudBackup>> {
  const qs = new URLSearchParams();
  if (params?.storeId) qs.set('storeId', params.storeId);
  const query = qs.toString();
  const res = await fetch(`${BASE_URL}/api/backups${query ? `?${query}` : ''}${buildPageQuery(params)}`, {
    headers: authHeaders(),
  });
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

export async function checkoutPlan(
  planId: string,
  opts?: {
    mobile?: string;
    redirectURL?: string;
    voucherCode?: string;
    affiliateCode?: string;
    affiliateCapturedAt?: string;
    /** Toko tujuan langganan (model per-toko berbayar). */
    storeId?: string;
    /** Durasi langganan: 1 | 6 | 12 bulan (default 1). */
    durationMonths?: 1 | 6 | 12;
  },
): Promise<CheckoutResult> {
  const res = await fetch(`${BASE_URL}/api/payments/checkout`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, ...opts }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Validasi kode affiliasi (publik) — dipakai saat menangkap link ?ref=KODE. */
export async function lookupAffiliate(code: string): Promise<AffiliateLookupResult> {
  const res = await fetch(`${BASE_URL}/api/affiliate/lookup?code=${encodeURIComponent(code)}`);
  if (!res.ok) {
    try {
      return (await res.json()) as AffiliateLookupResult;
    } catch {
      return { valid: false, error: 'Gagal memeriksa kode affiliasi' };
    }
  }
  return res.json() as Promise<AffiliateLookupResult>;
}

// === Affiliate dashboard (auth) ===

export interface AffiliateTier {
  tier: number;
  percent: number;
  description: string;
}

export interface AffiliateProfile {
  id: string;
  code: string;
  name: string;
  userId: string;
  referredBy: string | null;
  payoutNote: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateMeResult {
  ok: boolean;
  registered: boolean;
  affiliate?: AffiliateProfile;
  parentCode?: string | null;
  tiers: AffiliateTier[];
  link: string;
}

export interface AffiliateTreeNode {
  id: string;
  email: string;
  code: string;
  name?: string;
  commission: { count: number; earnedIdr: number; paidIdr: number };
  children: AffiliateTreeNode[];
}

export interface AffiliateTreeResult {
  ok: boolean;
  tiers: AffiliateTier[];
  tree: { affiliateId: string; level: number; users: AffiliateTreeNode[] };
}

export interface AffiliateCommissionRow {
  id: string;
  affiliateId: string;
  paymentId: string;
  userId: string;
  amountPaid: number;
  ratePercent: number;
  commissionIdr: number;
  tier: number;
  status: 'earned' | 'paid' | 'void';
  paidAt: string | null;
  createdAt: string;
}

export interface AffiliateCommissionsResult {
  ok: boolean;
  commissions: AffiliateCommissionRow[];
  summary: Record<number, { count: number; earnedIdr: number }>;
  totals: { earnedIdr: number; paidIdr: number };
}

export interface AffiliateClaimResult {
  ok: boolean;
  claimed: boolean;
  affiliate: AffiliateProfile;
  parentCode: string | null;
  tiers: AffiliateTier[];
  link: string;
}

/** Profil affiliasi user login (auth). */
export async function fetchAffiliateMe(): Promise<AffiliateMeResult> {
  const res = await fetch(`${BASE_URL}/api/affiliate/me`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Pohon downline s.d. 5 tier (auth). */
export async function fetchAffiliateTree(): Promise<AffiliateTreeResult> {
  const res = await fetch(`${BASE_URL}/api/affiliate/tree`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Komisi sendiri + ringkasan per tier (auth). */
export async function fetchAffiliateCommissions(): Promise<AffiliateCommissionsResult> {
  const res = await fetch(`${BASE_URL}/api/affiliate/commissions`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

/** Klaim jalur referral setelah OAuth (auth) — invite-only: kunci user ke affiliator pengundang. */
export async function claimAffiliate(body: { refCode: string; name?: string }): Promise<AffiliateClaimResult> {
  const res = await fetch(`${BASE_URL}/api/affiliate/claim`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}


/** Preview efek kode voucher (harga dihitung server, durasi 6/12 = price factor). */
export async function previewVoucher(
  code: string,
  planId: string,
  opts?: { durationMonths?: number },
): Promise<VoucherPreviewResult> {
  const res = await fetch(`${BASE_URL}/api/vouchers/preview`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, planId, durationMonths: opts?.durationMonths }),
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

// Cross-device sync is intentionally not exposed until the Worker can
// durably persist records and resolve pull/conflict behavior.

// === App Settings (public, no auth) ===
export interface AppSetting {
  key: string;
  value: Record<string, unknown>;
  description?: string | null;
  updatedAt: string;
}

export async function fetchAppSetting(key: string): Promise<AppSetting | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/app-settings/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) await parseError(res);
    return res.json();
  } catch (err) {
    console.warn(`[fetchAppSetting:${key}]`, err);
    return null;
  }
}

export { CloudApiError };

