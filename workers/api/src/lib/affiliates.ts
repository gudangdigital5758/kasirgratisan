/**
 * Affiliate Profitku — link referral + komisi otomatis 5 tier.
 *
 * Server-only (service role). Komisi dihitung/dicatat SAAT payment COMPLETED
 * (termasuk perpanjangan). Klien hanya mengirim kode referral; persen komisi
 * per tier selalu dibaca dari platform_settings (diatur admin).
 *
 * Model 5 tier (Opsi A — persen dari nominal pembayaran):
 *   tier 1 = referrer langsung (20%), tier 2..5 = ancestor (5/3/2/1%).
 *   Total payout maks 31% dari amount; nilai per tier bisa diubah admin.
 * Siapa pun dapat mendaftar jadi affiliator (auto REF); pohon referral dibangun
 * dari kolom `referred_by` saat registrasi memakai kode referal pemakai.
 */
import type { Env } from '../env';
import { ensureProfile, sbGet, sbPost } from './supabase';

export type AffiliateSettings = {
  enabled: boolean;
  /** Legacy: komisi tier tunggal (backward compat bila `tiers` kosong). */
  commission_percent: number;
  /** Komisi per tier (1..5), persen dari amount. Diatur admin (Opsi A). */
  tiers: number[];
  attribution_days: number;
  min_amount_idr: number;
};

export const MAX_TIERS = 5;

export const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
  enabled: true,
  commission_percent: 10,
  tiers: [20, 5, 3, 2, 1],
  attribution_days: 3650,
  min_amount_idr: 0,
};

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  referred_by: string | null;
  payout_note: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  is_active: boolean;
  click_count?: number;
  signup_count?: number;
  created_at: string;
  updated_at?: string;
};

/** Format kode: 4–24 karakter [A-Z0-9_-], tidak diawali underscore/dash. */
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{3,23}$/;

export function normalizeAffiliateCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidAffiliateCode(code: string): boolean {
  const c = normalizeAffiliateCode(code);
  return c.length >= 4 && CODE_RE.test(c);
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.floor(n)));
}

function clampTiers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw.slice(0, MAX_TIERS)) {
    const n = Number(v);
    out.push(Number.isFinite(n) ? clampPercent(n) : 0);
  }
  while (out.length < MAX_TIERS) out.push(0);
  return out.slice(0, MAX_TIERS);
}

/** Baca settings affiliate dari platform_settings (fallback default). */
export async function getAffiliateSettings(env: Env): Promise<AffiliateSettings> {
  try {
    const rows = await sbGet<{ key: string; value: Record<string, unknown> }[]>(
      env,
      'platform_settings?key=eq.affiliate&select=key,value&limit=1',
    );
    const v = rows[0]?.value;
    if (v && typeof v === 'object') {
      const tiers = clampTiers(v.tiers);
      return {
        enabled: v.enabled !== false,
        commission_percent: clampPercent(Number(v.commission_percent) || 0),
        tiers: tiers.length ? tiers : [clampPercent(Number(v.commission_percent) || 0)],
        attribution_days: Math.max(1, Math.min(3650, Number(v.attribution_days) || 3650)),
        min_amount_idr: Math.max(0, Math.floor(Number(v.min_amount_idr) || 0)),
      };
    }
  } catch (err) {
    console.warn('[affiliate settings]', err);
  }
  return { ...DEFAULT_AFFILIATE_SETTINGS };
}

const AFFILIATE_SELECT =
  'id,code,name,user_id,referred_by,payout_note,bank_name,bank_account_no,bank_account_name,is_active,click_count,signup_count,created_at,updated_at';

/** Muat affiliator aktif berdasarkan kode (case-insensitive). */
export async function loadAffiliateByCode(
  env: Env,
  code: string,
): Promise<AffiliateRow | null> {
  const normalized = normalizeAffiliateCode(code);
  if (!isValidAffiliateCode(normalized)) return null;
  const rows = await sbGet<AffiliateRow[]>(
    env,
    `affiliates?code=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=${AFFILIATE_SELECT}&limit=1`,
  );
  return rows[0] ?? null;
}

/** Muat affiliator (aktif/nonaktif) berdasarkan id. */
export async function loadAffiliateById(
  env: Env,
  id: string,
): Promise<AffiliateRow | null> {
  if (!id) return null;
  const rows = await sbGet<AffiliateRow[]>(
    env,
    `affiliates?id=eq.${id}&select=${AFFILIATE_SELECT}&limit=1`,
  );
  return rows[0] ?? null;
}

/** Muat affiliator milik user tertentu (unique per user). */
export async function loadAffiliateByUserId(
  env: Env,
  userId: string,
): Promise<AffiliateRow | null> {
  if (!userId) return null;
  const rows = await sbGet<AffiliateRow[]>(
    env,
    `affiliates?user_id=eq.${userId}&select=${AFFILIATE_SELECT}&limit=1`,
  );
  return rows[0] ?? null;
}

/** Generate kode REF acak (tanpa huruf/angka yang mudah tertukar: O/0/I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateAffiliateCode(prefix = 'AF'): string {
  let code = prefix;
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function cleanText(v: string | null | undefined, max = 120): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Daftar menjadi affiliator (auto REF) — HANYA via jalur invite (refCode wajib).
 * Idempotent — bila user sudah punya kode, kembalikan kode yang ada. Parent
 * (referred_by) selalu ditentukan dari kode referal pemakai; tanpa refCode atau
 * parent tidak valid/self → ditolak (invite-only).
 */
export async function registerAffiliate(
  env: Env,
  opts: {
    userId: string;
    email?: string | null;
    name: string;
    refCode: string;
    bankName?: string | null;
    bankAccountNo?: string | null;
    bankAccountName?: string | null;
    payoutNote?: string | null;
  },
): Promise<{ affiliate: AffiliateRow; created: boolean; parentCode: string | null }> {
  await ensureProfile(env, {
    id: opts.userId,
    email: opts.email ?? undefined,
    name: opts.name,
  });

  const existing = await loadAffiliateByUserId(env, opts.userId);
  if (existing) return { affiliate: existing, created: false, parentCode: null };

  // Invite-only: kode referal wajib dan parent harus valid + aktif.
  if (!opts.refCode) throw new Error('Kode referal wajib diisi');
  const parent = await loadAffiliateByCode(env, opts.refCode);
  if (!parent) throw new Error('Kode referal tidak valid');
  if (parent.user_id && parent.user_id === opts.userId) {
    throw new Error('Kode referal tidak valid'); // self-referral: tidak bisa mengundang diri sendiri
  }
  const referredBy = parent.id;
  const parentCode = parent.code;

  const name = cleanText(opts.name, 120) || 'Affiliator';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAffiliateCode();
    try {
      const rows = await sbPost<AffiliateRow[]>(env, 'affiliates', {
        code,
        name,
        user_id: opts.userId,
        referred_by: referredBy,
        payout_note: cleanText(opts.payoutNote),
        bank_name: cleanText(opts.bankName),
        bank_account_no: cleanText(opts.bankAccountNo),
        bank_account_name: cleanText(opts.bankAccountName),
        is_active: true,
      });
      const row = rows[0];
      if (!row) throw new Error('Gagal membuat kode affiliasi');
      return { affiliate: row, created: true, parentCode };
    } catch (err) {
      if (!(err instanceof Error) || !/duplicate/i.test(err.message)) throw err;
      // kode bentrok — coba lagi dengan kode acak baru
    }
  }
  throw new Error('Gagal membuat kode affiliasi (kode bentrok)');
}

/**
 * Klaim jalur referral setelah login Google dari link ?ref=KODE.
 * Idempotent — first valid referral wins: user yang sudah punya affiliate row
 * TIDAK diganti parent-nya; parent di-resolve dari referred_by agar response
 * akurat. Auto-register user sebagai affiliator (kode REF sendiri) sesuai
 * keputusan 2026-08-10 (docs/DECISIONS.md).
 */
export async function claimAffiliate(
  env: Env,
  opts: {
    userId: string;
    email?: string | null;
    name?: string | null;
    refCode: string;
  },
): Promise<{ affiliate: AffiliateRow; created: boolean; parentCode: string | null }> {
  const resolveParentCode = async (row: AffiliateRow): Promise<string | null> => {
    if (!row.referred_by) return null;
    const parent = await loadAffiliateById(env, row.referred_by);
    return parent?.code ?? null;
  };

  const existing = await loadAffiliateByUserId(env, opts.userId);
  if (existing) return { affiliate: existing, created: false, parentCode: await resolveParentCode(existing) };

  try {
    return await registerAffiliate(env, {
      userId: opts.userId,
      email: opts.email ?? undefined,
      name: opts.name ?? '',
      refCode: opts.refCode,
    });
  } catch (err) {
    // Race double-claim: unique index affiliates_user_uidx menang — kembalikan row existing.
    if (err instanceof Error && /duplicate/i.test(err.message)) {
      const row = await loadAffiliateByUserId(env, opts.userId);
      if (row) return { affiliate: row, created: false, parentCode: await resolveParentCode(row) };
    }
    throw err;
  }
}

/** Hitung komisi untuk satu tier (floor ke rupiah penuh). */
export function computeCommission(
  amountPaid: number,
  settings: AffiliateSettings,
  tier: number,
): { ratePercent: number; commissionIdr: number } {
  const rate = clampPercent(settings.tiers[tier - 1] ?? 0);
  const commissionIdr = Math.floor(Math.max(0, Math.floor(amountPaid)) * (rate / 100));
  return { ratePercent: rate, commissionIdr };
}

/**
 * Catat komisi untuk satu payment selesai (5 tier). Idempotent per (payment, tier).
 * Best-effort — kegagalan di sini TIDAK menggagalkan fulfillment langganan.
 * Berfungsi juga untuk perpanjangan karena dipanggil dari fulfillCompletedPayment.
 *
 * Atribusi: bila `capturedAt` diberikan dan lebih tua dari `attribution_days`,
 * kode dianggap kedaluwarsa dan komisi TIDAK dicatat.
 *
 * Rantai: direct referrer = tier 1, lalu naik ke parent (referred_by) s.d. 5
 * level atau berhenti bila rantai putus / parent nonaktif.
 * Self-referral: bila pemilik kode = pembayar sendiri, dia dilewati — rantai
 * dimulai dari parent-nya (tier 1 = pengundangnya); tanpa parent → tanpa komisi.
 */
export async function recordAffiliateCommission(
  env: Env,
  opts: {
    paymentId: string;
    userId: string;
    affiliateCode: string;
    amountPaid: number;
    capturedAt?: string | null;
  },
): Promise<boolean> {
  try {
    const settings = await getAffiliateSettings(env);
    if (!settings.enabled) return false;
    if (opts.amountPaid < settings.min_amount_idr) return false;

    // Jendela atribusi: klik link → berlangganan dalam N hari.
    if (opts.capturedAt) {
      const captured = new Date(opts.capturedAt).getTime();
      if (!Number.isFinite(captured) || Date.now() - captured > settings.attribution_days * 86400000) {
        return false;
      }
    }

    // Direct referrer (tier 1) harus aktif & valid.
    let current = await loadAffiliateByCode(env, opts.affiliateCode);
    if (!current) return false;

    // Self-referral: pemilik kode = pembayar sendiri → jangan beri komisi ke
    // diri sendiri; mulai rantai dari parent (tier 1 = pengundangnya).
    if (current.user_id && current.user_id === opts.userId) {
      if (!current.referred_by) return false;
      const parent = await loadAffiliateById(env, current.referred_by);
      if (!parent || !parent.is_active) return false;
      current = parent;
    }

    // Idempotent: bila sudah ada komisi untuk payment ini, jangan tulis ulang.
    const existing = await sbGet<{ id: string }[]>(
      env,
      `affiliate_commissions?payment_id=eq.${opts.paymentId}&select=id&limit=1`,
    );
    if (existing[0]) return true;

    const visited = new Set<string>();
    let tier = 1;
    let inserted = 0;
    while (current && tier <= MAX_TIERS && !visited.has(current.id)) {
      visited.add(current.id);
      const { ratePercent, commissionIdr } = computeCommission(opts.amountPaid, settings, tier);
      if (ratePercent > 0 && commissionIdr > 0) {
        try {
          await sbPost(env, 'affiliate_commissions', {
            affiliate_id: current.id,
            payment_id: opts.paymentId,
            user_id: opts.userId,
            amount_paid: opts.amountPaid,
            rate_percent: ratePercent,
            commission_idr: commissionIdr,
            tier,
            status: 'earned',
          });
          inserted++;
        } catch (err) {
          // duplicate (payment, tier) — idempotent; lanjut level berikutnya
          console.warn('[affiliate commission insert]', err);
        }
      }
      if (!current.referred_by) break;
      const parent = await loadAffiliateById(env, current.referred_by);
      if (!parent || !parent.is_active) break;
      current = parent;
      tier++;
    }
    return inserted > 0;
  } catch (err) {
    console.warn('[affiliate commission]', err);
    return false;
  }
}

// ==== Pohon referral (dashboard affiliator) ====

export type AffiliateTreeNode = {
  id: string;
  code: string;
  name: string;
  tier: number;
  isActive: boolean;
  createdAt: string;
  stats: { commissions: number; earnedIdr: number };
  children: AffiliateTreeNode[];
};

export const TREE_MAX_DEPTH = 5;
export const TREE_MAX_NODES = 500;

/**
 * Bangun pohon downline s.d. 5 level dari root (termasuk root di tier 1).
 * Komisi per node diagregasi dari affiliate_commissions (status != void).
 */
export async function buildAffiliateTree(
  env: Env,
  rootId: string,
): Promise<AffiliateTreeNode | null> {
  const [affiliates, commissions] = await Promise.all([
    sbGet<AffiliateRow[]>(
      env,
      'affiliates?select=id,code,name,user_id,referred_by,is_active,created_at&limit=2000',
    ),
    sbGet<{ affiliate_id: string; commission_idr: number; status: string }[]>(
      env,
      'affiliate_commissions?select=affiliate_id,commission_idr,status&limit=20000',
    ).catch(() => []),
  ]);

  const root = affiliates.find((a) => a.id === rootId);
  if (!root) return null;

  const stats = new Map<string, { commissions: number; earnedIdr: number }>();
  for (const cm of commissions) {
    if (cm.status === 'void') continue;
    const s = stats.get(cm.affiliate_id) ?? { commissions: 0, earnedIdr: 0 };
    s.commissions += 1;
    s.earnedIdr += cm.commission_idr || 0;
    stats.set(cm.affiliate_id, s);
  }

  const childrenByParent = new Map<string, AffiliateRow[]>();
  for (const a of affiliates) {
    if (!a.referred_by) continue;
    const list = childrenByParent.get(a.referred_by) ?? [];
    list.push(a);
    childrenByParent.set(a.referred_by, list);
  }

  const nodeFor = (
    a: AffiliateRow,
    tier: number,
    budget: { used: number },
  ): AffiliateTreeNode | null => {
    if (tier > TREE_MAX_DEPTH || budget.used >= TREE_MAX_NODES) return null;
    budget.used += 1;
    const children: AffiliateTreeNode[] = [];
    for (const child of childrenByParent.get(a.id) ?? []) {
      const childNode = nodeFor(child, tier + 1, budget);
      if (childNode) children.push(childNode);
    }
    const s = stats.get(a.id) ?? { commissions: 0, earnedIdr: 0 };
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      tier,
      isActive: a.is_active,
      createdAt: a.created_at,
      stats: { commissions: s.commissions, earnedIdr: s.earnedIdr },
      children,
    };
  };

  return nodeFor(root, 1, { used: 0 });
}
