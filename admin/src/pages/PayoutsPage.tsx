import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminPayoutRow } from '../lib/api';
import { useAutoRefresh, refreshStamp } from '../lib/use-auto-refresh';

const rp = (n: number) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;

function previousPeriod(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayoutsPage() {
  const [period, setPeriod] = useState(previousPeriod());
  const [rows, setRows] = useState<AdminPayoutRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setErr(null);
    try {
      const r = await adminApi.payouts(p);
      setRows(r.payouts);
      setLastSync(refreshStamp());
    } catch (e) {
      setRows([]);
      setErr(e instanceof Error ? e.message : 'Gagal memuat payout');
    }
  }, []);

  useEffect(() => {
    document.title = 'Pencairan Komisi · Profitku Admin';
    void load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, load]);

  // Auto-refresh: fokus tab + setiap 60 detik (cron payout baru langsung terlihat).
  useAutoRefresh(() => void load(period), 60_000);

  const run = async () => {
    if (!window.confirm(`Jalankan payout untuk periode ${period}? (idempotent — aman diulang)`)) return;
    setBusy('run');
    setErr(null);
    setOk(null);
    try {
      const r = await adminApi.runPayouts(period);
      const msg = r.skipped
        ? 'Periode sudah diproses (skip).'
        : `Payout dibuat: ${r.created} mitra.`;
      setOk(`${msg}${r.errors.length ? ` Error: ${r.errors.join(', ')}` : ''}`);
      await load(period);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal menjalankan payout');
    } finally {
      setBusy(null);
    }
  };

  const confirmPaid = async (p: AdminPayoutRow) => {
    if (!window.confirm(`Konfirmasi payout ${p.affiliateCode} (${rp(p.netIdr)} net) sudah ditransfer? Komisi akan ditandai PAID.`)) return;
    setBusy(p.id);
    setErr(null);
    setOk(null);
    try {
      const r = await adminApi.confirmPayout(p.id);
      setOk(`${p.affiliateCode}: ${r.updated} komisi ditandai paid.`);
      await load(period);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal konfirmasi');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (p: AdminPayoutRow) => {
    if (!window.confirm(`Batalkan payout ${p.affiliateCode}? Komisi kembali ke status earned.`)) return;
    setBusy(p.id);
    setErr(null);
    setOk(null);
    try {
      const r = await adminApi.cancelPayout(p.id);
      setOk(`${p.affiliateCode}: ${r.removed} payout dibatalkan.`);
      await load(period);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal membatalkan');
    } finally {
      setBusy(null);
    }
  };

  const totals = rows.reduce(
    (s, p) => ({
      gross: s.gross + p.grossIdr,
      tax: s.tax + p.taxIdr,
      net: s.net + p.netIdr,
      paid: s.paid + (p.status === 'paid' ? p.netIdr : 0),
    }),
    { gross: 0, tax: 0, net: 0, paid: 0 },
  );

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Pencairan Komisi (Payout)</h2>
      <p className="muted" style={{ margin: 0 }}>
        Payout bulanan: komisi earned ≥ threshold dikumpulkan per periode, potong PPh 23
        (2% NPWP / 4% tanpa NPWP). Transfer manual oleh finance → konfirmasi → komisi PAID.
        Export CSV untuk bahan e-Bupot.{lastSync ? ` · refresh ${lastSync}` : ''}
      </p>

      {err && <p className="err">{err}</p>}
      {ok && <p className="ok">{ok}</p>}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack">
          <span className="muted">Periode (YYYY-MM)</span>
          <input
            className="input"
            style={{ maxWidth: 140 }}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-07"
          />
        </label>
        <button type="button" className="btn small" disabled={busy === 'run'} onClick={() => void run()}>
          {busy === 'run' ? 'Memproses…' : 'Jalankan Payout'}
        </button>
        <a className="btn ghost small" href={adminApi.payoutExportUrl(period)} target="_blank" rel="noreferrer">
          Export CSV (e-Bupot)
        </a>
      </div>

      {rows.length > 0 && (
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <span className="muted">Gross: <b>{rp(totals.gross)}</b></span>
          <span className="muted">PPh 23: <b>{rp(totals.tax)}</b></span>
          <span className="muted">Net: <b>{rp(totals.net)}</b></span>
          <span className="muted">Sudah cair: <b>{rp(totals.paid)}</b></span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">Belum ada payout untuk periode ini. Jalankan payout atau pilih periode lain.</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Mitra</th>
                <th>Gross</th>
                <th>PPh 23</th>
                <th>Net</th>
                <th>Rekening</th>
                <th>Status</th>
                <th>Komisi</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.affiliateName ?? '—'}</strong> <code>{p.affiliateCode}</code>
                  </td>
                  <td>{rp(p.grossIdr)}</td>
                  <td>{p.taxRatePercent}% · {rp(p.taxIdr)}</td>
                  <td><b>{rp(p.netIdr)}</b></td>
                  <td className="muted">
                    {[p.bankName, p.bankAccountNo, p.bankAccountName].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>
                    <span className={`badge ${p.status === 'paid' ? 'ok' : p.status === 'cancelled' ? 'err' : 'warn'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p.commissionCount}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {p.status === 'generated' && (
                        <>
                          <button type="button" className="btn small" disabled={busy === p.id} onClick={() => void confirmPaid(p)}>
                            Konfirmasi Paid
                          </button>
                          <button type="button" className="btn small danger" disabled={busy === p.id} onClick={() => void cancel(p)}>
                            Batal
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

