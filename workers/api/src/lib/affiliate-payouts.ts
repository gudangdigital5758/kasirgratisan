/**
 * Profitku API — payout komisi affiliate bulanan (Level 1, semi-otomatis).
 *
 * Alur:
 *  1. Cron (daily) / admin POST /admin/api/affiliates/payouts/run
 *     → proses periode bulan SEBELUMNYA (komisi bulan lalu dicairkan awal bulan ini).
 *  2. Pilih mitra dengan komisi earned (payout_id null) >= threshold min_amount_idr.
 *  3. Hitung PPh 23: 2% (punya NPWP) / 4% (tanpa NPWP). net = gross - tax.
 *  4. Insert baris affiliate_payouts (status generated) + kunci komisi via payout_id
 *     (unique affiliate_id+period = idempotent; re-run aman).
 *  5. Notif email/WA best-effort. Admin transfer manual → confirm → komisi paid.
 *
 * Dibatalkan (DELETE payout) → payout_id set null (FK) → komisi kembali earned.
 */

import type { Env } from '../env';
import { sbGet, sbPatch, sbPost } from './supabase';
import { getAffiliateSettings } from './affiliates';
import { sendEmail, sendWhatsApp } from './notify';
import { writeEvent } from './admin';

export type AffiliatePayoutRow = {
  id: string;
  affiliate_id: string;
  period: string;
  gross_idr: number;
  tax_rate_percent: number;
  tax_idr: number;
  net_idr: number;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  status: string;
  commission_ids: unknown;
  paid_at: string | null;
  created_at: string;
};

type AffRow = {
  id: string;
  user_id: string | null;
  has_npwp: boolean;
  min_amount_idr: number | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
};

type CmRow = { id: string; affiliate_id: string; commission_idr: number };

/** Periode bulan sebelumnya (UTC), format YYYY-MM. */
export function previousPayoutPeriod(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export type PayoutRunResult = {
  period: string;
  created: number;
  skipped: boolean;
  errors: string[];
};

/**
 * Proses payout untuk satu periode. Idempotent:
 * - periode sudah punya baris payout → skip (unique affiliate_id+period juga menjaga).
 * - komisi yang sudah terikat payout lain (payout_id is not null) tidak diikutkan.
 */
export async function runMonthlyPayouts(env: Env, period?: string): Promise<PayoutRunResult> {
  const target = period ?? previousPayoutPeriod();
  const empty: PayoutRunResult = { period: target, created: 0, skipped: false, errors: [] };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...empty, errors: ['database_not_configured'] };
  }

  try {
    const existing = await sbGet<{ id: string }[]>(
      env,
      `affiliate_payouts?period=eq.${target}&select=id&limit=1`,
    ).catch(() => [] as { id: string }[]);
    if (existing.length > 0) {
      return { ...empty, skipped: true };
    }

    const settings = await getAffiliateSettings(env);
    if (settings.min_amount_idr <= 0) {
      return { ...empty, errors: ['threshold_off'] };
    }

    const [affiliates, commissions] = await Promise.all([
      sbGet<AffRow[]>(
        env,
        'affiliates?select=id,user_id,has_npwp,min_amount_idr,bank_name,bank_account_no,bank_account_name&limit=2000',
      ).catch(() => [] as AffRow[]),
      sbGet<CmRow[]>(
        env,
        'affiliate_commissions?status=eq.earned&payout_id=is.null&select=id,affiliate_id,commission_idr&limit=20000',
      ).catch(() => [] as CmRow[]),
    ]);

    const byAff = new Map<string, { ids: string[]; total: number }>();
    for (const cm of commissions) {
      const e = byAff.get(cm.affiliate_id) ?? { ids: [], total: 0 };
      e.ids.push(cm.id);
      e.total += cm.commission_idr || 0;
      byAff.set(cm.affiliate_id, e);
    }

    const errors: string[] = [];
    let created = 0;

    for (const aff of affiliates) {
      const e = byAff.get(aff.id);
      // Threshold per mitra (override) atau global.
      const threshold = aff.min_amount_idr ?? settings.min_amount_idr;
      if (!e || e.total < threshold) continue;

      const rate = aff.has_npwp ? 2 : 4;
      const tax = Math.round((e.total * rate) / 100);
      const net = e.total - tax;

      try {
        const ins = await sbPost<AffiliatePayoutRow[]>(env, 'affiliate_payouts', {
          affiliate_id: aff.id,
          period: target,
          gross_idr: e.total,
          tax_rate_percent: rate,
          tax_idr: tax,
          net_idr: net,
          bank_name: aff.bank_name,
          bank_account_no: aff.bank_account_no,
          bank_account_name: aff.bank_account_name,
          status: 'generated',
          commission_ids: e.ids,
        });
        const payout = ins[0];
        if (!payout) {
          errors.push(`${aff.id}:no_row`);
          continue;
        }
        // Kunci komisi ke payout ini (filter ulang: hanya yang belum terikat).
        await sbPatch(
          env,
          `affiliate_commissions?payout_id=is.null&status=eq.earned&id=in.(${e.ids.join(',')})`,
          { payout_id: payout.id },
        );
        created += 1;

        // Notif best-effort (email/WA bila profil tersedia).
        if (aff.user_id) {
          try {
            const profs = await sbGet<{ email: string | null; phone: string | null }[]>(
              env,
              `profiles?id=eq.${aff.user_id}&select=email,phone&limit=1`,
            ).catch(() => [] as { email: string | null; phone: string | null }[]);
            const prof = profs[0];
            if (prof?.email) {
              await sendEmail(env, {
                to: prof.email,
                subject: 'Komisi Profitku siap dicairkan',
                html: `Komisi kamu <b>Rp ${net.toLocaleString('id-ID')}</b> (net setelah PPh 23 ${rate}%) untuk periode ${target} sudah masuk daftar pencairan. Admin akan memproses transfer.`,
              });
            }
            if (prof?.phone) {
              await sendWhatsApp(env, {
                target: prof.phone,
                message: `Komisi Profitku kamu Rp ${net.toLocaleString('id-ID')} (net, PPh 23 ${rate}%) periode ${target} siap dicairkan.`,
              });
            }
          } catch (err) {
            console.warn('[payout notify]', aff.id, err);
          }
        }
      } catch (err) {
        errors.push(aff.id);
        console.warn('[payout run]', aff.id, err);
      }
    }

    await writeEvent(env, {
      type: 'affiliate_payout_run',
      message: `payout ${target}: ${created} mitra`,
      actorUserId: null,
      payload: { period: target, created, errors: errors.length },
    });
    return { period: target, created, skipped: false, errors };
  } catch (err) {
    console.error('[payout run]', err);
    return { ...empty, errors: [err instanceof Error ? err.message : 'payout_failed'] };
  }
}

