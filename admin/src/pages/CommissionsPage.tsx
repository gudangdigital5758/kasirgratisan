import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminCommissionRow } from '../lib/api';
import { useAutoRefresh, refreshStamp } from '../lib/use-auto-refresh';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const statusLabel = (s: string) => (s === 'paid' ? 'paid' : s === 'void' ? 'void' : 'earned');

type AffSummary = {
  affiliateId: string;
  code: string;
  name: string;
  earned: number;
  paid: number;
  pending: number;
  count: number;
};

export default function CommissionsPage() {
  const [rows, setRows] = useState<AdminCommissionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [paidDone, setPaidDone] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    adminApi
      .affiliateCommissions()
      .then((r) => {
        setRows(r.commissions);
        setLastSync(refreshStamp());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat komisi'));
  }, []);

  useEffect(() => {
    document.title = 'Komisi Affiliate · Profitku Admin';
    load();
  }, [load]);

  // Auto-refresh: perubahan komisi/payout dari halaman lain langsung terlihat.
  useAutoRefresh(load, 60_000);

  /** Agregasi per affiliator (semua baris, bukan hasil filter) untuk aksi tandai paid. */
  const byAff = useMemo(() => {
    const map = new Map<string, AffSummary>();
    for (const c of rows) {
      if (c.status === 'void') continue;
      const s = map.get(c.affiliateId) ?? {
        affiliateId: c.affiliateId,
        code: c.affiliateCode ?? '—',
        name: c.affiliateName ?? '',
        earned: 0,
        paid: 0,
        pending: 0,
        count: 0,
      };
      s.earned += c.commissionIdr || 0;
      if (c.status === 'paid') s.paid += c.commissionIdr || 0;
      s.count += 1;
      map.set(c.affiliateId, s);
    }
    const list = [...map.values()];
    for (const s of list) s.pending = s.earned - s.paid;
    return list.sort((a, b) => b.pending - a.pending);
  }, [rows]);

  /** Tandai SEMUA komisi earned satu affiliator sebagai paid (feedback tombol). */
  const markPaidFor = async (a: AffSummary) => {
    if (!window.confirm(`Tandai SEMUA komisi earned ${a.code} sebagai PAID?`)) return;
    setActionBusy(`paid:${a.affiliateId}`);
    setErr(null);
    try {
      const res = await adminApi.markAffiliatePaid(a.affiliateId);
      setPaidDone((m) => ({ ...m, [a.affiliateId]: true }));
      setTimeout(() => setPaidDone((m) => ({ ...m, [a.affiliateId]: false })), 1500);
      await load();
      if (res.updated > 0) setErr(null);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal menandai paid');
    } finally {
      setActionBusy(null);
    }
  };

  /** Unduh CSV komisi (blob → file). */
  const exportCsv = async () => {
    try {
      const blob = await adminApi.affiliateCommissionsExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `komisi-affiliate-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal export CSV');
    }
  };

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? rows.filter((c) =>
            [c.affiliateCode, c.affiliateName, c.userEmail, c.status, String(c.tier ?? 1)]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle)),
          )
        : rows,
    [rows, needle],
  );

  const totals = useMemo(() => {
    let earnedCount = 0;
    let earnedIdr = 0;
    let paidIdr = 0;
    for (const c of rows) {
      if (c.status === 'void') continue;
      earnedCount += 1;
      earnedIdr += c.commissionIdr || 0;
      if (c.status === 'paid') paidIdr += c.commissionIdr || 0;
    }
    return { earnedCount, earnedIdr, paidIdr };
  }, [rows]);

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Komisi Affiliate</h2>
        <p className="muted">
          Semua komisi lintas affiliator · {rows.length} baris{lastSync ? ` · refresh ${lastSync}` : ''}
        </p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost small" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="card kpi">
          <div className="label">Komisi (non-void)</div>
          <div className="value">{totals.earnedCount}</div>
        </div>
        <div className="card kpi">
          <div className="label">Total earned</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>{rp(totals.earnedIdr)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Sudah dibayar</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>{rp(totals.paidIdr)}</div>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Per Affiliator</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            Untuk payout resmi (threshold + PPh 23) gunakan menu{' '}
            <a href="/payouts">Pencairan</a>.
          </span>
        </div>
        {byAff.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Belum ada komisi.</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {byAff.map((a) => (
              <div key={a.affiliateId} className="card stack" style={{ gap: '0.35rem', boxShadow: 'none' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <code>{a.code}</code>
                  <span className="muted" style={{ fontSize: 11 }}>{a.count} komisi</span>
                </div>
                {a.name && <strong>{a.name}</strong>}
                <div className="muted" style={{ fontSize: 12 }}>
                  earned <b>{rp(a.earned)}</b> · pending{' '}
                  <b style={{ color: a.pending > 0 ? 'var(--warn, #b45309)' : undefined }}>{rp(a.pending)}</b>{' '}
                  · paid {rp(a.paid)}
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ fontSize: 12, padding: '4px 10px', alignSelf: 'flex-start' }}
                  disabled={actionBusy !== null || a.pending <= 0}
                  onClick={() => void markPaidFor(a)}
                >
                  {paidDone[a.affiliateId]
                    ? 'Done paid'
                    : actionBusy === `paid:${a.affiliateId}`
                      ? '...'
                      : 'Tandai paid'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 360 }}
          placeholder="Cari affiliator / kode / email / status…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">{filtered.length} komisi</span>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Affiliator</th>
              <th>Pembayar</th>
              <th>Tier</th>
              <th>Dibayar</th>
              <th>Rate</th>
              <th>Komisi</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  Belum ada komisi
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id}>
                  <td data-label="Tanggal" className="muted">
                    {new Date(c.createdAt).toLocaleString('id-ID')}
                  </td>
                  <td data-label="Affiliator">
                    <code>{c.affiliateCode ?? '—'}</code>
                    {c.affiliateName && <div style={{ fontSize: 12 }}>{c.affiliateName}</div>}
                  </td>
                  <td data-label="Pembayar" className="muted">
                    {c.userEmail || <code>{c.userId.slice(0, 8)}…</code>}
                  </td>
                  <td data-label="Tier">Tier {c.tier ?? 1}</td>
                  <td data-label="Dibayar">{rp(c.amountPaid)}</td>
                  <td data-label="Rate">{c.ratePercent}%</td>
                  <td data-label="Komisi">
                    <b>{rp(c.commissionIdr)}</b>
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${c.status === 'paid' ? 'ok' : c.status === 'void' ? 'warn' : ''}`}>
                      {statusLabel(c.status)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
