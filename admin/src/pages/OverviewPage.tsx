import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/api';
import { useAutoRefresh } from '../lib/use-auto-refresh';

function rp(n: number) {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export default function OverviewPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.overview>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .overview()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  }, []);

  useEffect(() => {
    document.title = 'Overview · Profitku Admin';
    load();
  }, [load]);

  // Auto-refresh saat tab kembali fokus (snapshot cloud selalu segar).
  useAutoRefresh(load);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Memuat overview…</p>;

  return (
    <div className="stack">
      {/* Title group (wireframe: judul + subjudul sebaris) */}
      <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Overview</h2>
        <p className="muted">Snapshot cloud Profitku · {new Date(data.generatedAt).toLocaleString('id-ID')}</p>
      </div>

      {/* Summary cards (wireframe experiment-dashboard: grid-4, value 30px, label 14px) */}
      <div className="grid grid-4">
        <div className="card kpi">
          <div className="label">Members</div>
          <div className="value">{data.members}</div>
        </div>
        <div className="card kpi">
          <div className="label">Sub aktif</div>
          <div className="value">{data.activeSubscriptions}</div>
        </div>
        <div className="card kpi">
          <div className="label">MRR ≈ (sub × 25rb)</div>
          <div className="value" style={{ fontSize: '1.5rem' }}>
            {rp(data.mrrApproxIdr)}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Backup 24 jam</div>
          <div className="value">{data.backupsLast24h}</div>
        </div>
      </div>

      {/* Main panel (wireframe main-card: header + body) */}
      <div className="card panel">
        <div className="panel-head">
          <div className="panel-title">Ringkasan</div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="tab-btn" to="/members">
              Members
            </Link>
            <Link className="tab-btn" to="/events">
              Live events
            </Link>
            <Link className="tab-btn" to="/payments">
              Payments
            </Link>
          </div>
        </div>
        <div className="panel-body">
          <table>
            <thead>
              <tr>
                <th>Metrik</th>
                <th style={{ textAlign: 'right' }}>Nilai</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Revenue sample (≤500 COMPLETED)</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{rp(data.revenueCompletedSampleIdr)}</td>
              </tr>
              <tr>
                <td>Paket langganan</td>
                <td style={{ textAlign: 'right' }}>{rp(data.planPriceIdr)}/bln</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
