import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, type MemberRow } from '../lib/api';

export default function MembersPage() {
  const [q, setQ] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (query?: string) => {
    setLoading(true);
    adminApi
      .members(query)
      .then((r) => setMembers(r.members))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    document.title = 'Members · Profitku Admin';
    load();
  }, []);

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Members</h2>
        <p className="muted">Profil cloud Supabase + status langganan</p>
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
      >
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Cari email / nama…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" type="submit">
          Cari
        </button>
      </form>

      {err && <p className="err">{err}</p>}
      {loading ? (
        <p className="muted">Memuat…</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Nama / email</th>
                <th>Langganan</th>
                <th>Daftar</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/members/${m.id}`} style={{ fontWeight: 600, color: '#ea580c' }}>
                      {m.name || '—'}
                    </Link>
                    <div className="muted">{m.email}</div>
                  </td>
                  <td>
                    {m.subscription?.active ? (
                      <>
                        <span className="badge ok">{m.subscription.status}</span>
                        <div className="muted">
                          s/d {new Date(m.subscription.currentPeriodEnd).toLocaleDateString('id-ID')}
                        </div>
                      </>
                    ) : (
                      <span className="badge">inactive</span>
                    )}
                  </td>
                  <td className="muted">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString('id-ID') : '—'}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Tidak ada data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
