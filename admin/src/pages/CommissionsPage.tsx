import { useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminCommissionRow } from '../lib/api';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const statusLabel = (s: string) => (s === 'paid' ? 'paid' : s === 'void' ? 'void' : 'earned');

export default function CommissionsPage() {
  const [rows, setRows] = useState<AdminCommissionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    document.title = 'Commissions · Profitku Admin';
    adminApi
      .affiliateCommissions()
      .then((r) => setRows(r.commissions))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat komisi'));
  }, []);

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
        <p className="muted">Semua komisi lintas affiliator · {rows.length} baris</p>
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
