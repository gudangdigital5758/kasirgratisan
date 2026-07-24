import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/api';

function rp(n: number) {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export default function OverviewPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.overview>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Overview · Profitku Admin';
    adminApi
      .overview()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  }, []);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Memuat overview…</p>;

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Overview</h2>
        <p className="muted">Snapshot cloud Profitku · {new Date(data.generatedAt).toLocaleString('id-ID')}</p>
      </div>

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
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {rp(data.mrrApproxIdr)}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Backup 24 jam</div>
          <div className="value">{data.backupsLast24h}</div>
        </div>
      </div>

      <div className="card stack">
        <strong>Quick links</strong>
        <div className="row">
          <Link className="btn ghost" to="/members">
            Members
          </Link>
          <Link className="btn ghost" to="/events">
            Live events
          </Link>
          <Link className="btn ghost" to="/payments">
            Payments
          </Link>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Revenue sample (last ≤500 COMPLETED): {rp(data.revenueCompletedSampleIdr)} · paket{' '}
          {rp(data.planPriceIdr)}/bln
        </p>
      </div>
    </div>
  );
}
