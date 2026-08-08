import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type PaymentRow } from '../lib/api';

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Payments · Profitku Admin';
    adminApi
      .payments()
      .then((r) => setRows(r.payments as PaymentRow[]))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  }, []);

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Payments</h2>
        <p className="muted">50 transaksi terbaru</p>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>User</th>
              <th>Plan</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td data-label="Waktu" className="muted">{new Date(p.created_at).toLocaleString('id-ID')}</td>
                <td data-label="User">
                  <Link to={`/members/${p.user_id}`} style={{ color: 'var(--primary)' }}>
                    {p.user_id.slice(0, 8)}…
                  </Link>
                </td>
                <td data-label="Plan">{p.plan_id}</td>
                <td data-label="Amount">Rp {(p.amount || 0).toLocaleString('id-ID')}</td>
                <td data-label="Status">
                  <span className={`badge ${p.status === 'COMPLETED' ? 'ok' : ''}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
