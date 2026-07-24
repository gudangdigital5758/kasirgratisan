import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, type MemberDetail } from '../lib/api';
import { useAdminAuth } from '../lib/auth';

export default function MemberDetailPage() {
  const { id } = useParams();
  const { me } = useAdminAuth();
  const [data, setData] = useState<MemberDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!id) return;
    adminApi
      .member(id)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  };

  useEffect(() => {
    document.title = 'Member · Profitku Admin';
    load();
  }, [id]);

  const extend = async () => {
    if (!id || !me?.canMutateBilling) return;
    setBusy(true);
    try {
      await adminApi.extend(id, Number(days) || 30, reason || 'manual admin');
      alert('Langganan diperpanjang');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Memuat…</p>;

  const p = data.profile;

  return (
    <div className="stack">
      <div className="row">
        <Link className="btn ghost" to="/members">
          ← Members
        </Link>
      </div>

      <div className="card stack">
        <div className="row" style={{ gap: '1rem' }}>
          {p.picture && (
            <img src={p.picture} alt="" width={48} height={48} style={{ borderRadius: 999 }} />
          )}
          <div>
            <h2 style={{ margin: 0 }}>{p.name || '—'}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {p.email} · {p.phone || 'no phone'}
            </p>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
              {p.id}
            </p>
          </div>
        </div>
      </div>

      {me?.canMutateBilling && (
        <div className="card stack">
          <strong>Extend langganan (manual)</strong>
          <div className="row">
            <input
              className="input"
              style={{ width: 100 }}
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className="muted">hari</span>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Alasan (audit)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button className="btn" type="button" disabled={busy} onClick={() => void extend()}>
              {busy ? '…' : 'Extend'}
            </button>
          </div>
        </div>
      )}

      <Section title="Subscriptions" rows={data.subscriptions} />
      <Section title="Payments" rows={data.payments} />
      <Section title="Stores" rows={data.stores} />
      <Section title="Backups" rows={data.backups} />
      <Section title="Notifications" rows={data.notifications} />
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  return (
    <div className="card stack">
      <strong>
        {title} ({rows.length})
      </strong>
      {rows.length === 0 ? (
        <p className="muted">Kosong</p>
      ) : (
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 220,
            background: '#f8fafc',
            padding: 8,
            borderRadius: 8,
          }}
        >
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  );
}
