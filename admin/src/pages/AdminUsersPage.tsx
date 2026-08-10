import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminUserRow } from '../lib/api';
import { useAdminAuth } from '../lib/auth';

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  support: 'Support',
  finance: 'Finance',
  readonly: 'Read only',
};

export default function AdminUsersPage() {
  const { me } = useAdminAuth();
  const isSuperadmin = me?.role === 'superadmin';

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');

  const load = useCallback(() => {
    setErr(null);
    adminApi
      .adminUsers()
      .then((r) => setRows(r.admins))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat staff'));
  }, []);

  useEffect(() => {
    document.title = 'Staff · Profitku Admin';
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperadmin) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await adminApi.createAdminUser({ email, role });
      setOk(`Staff ${res.admin.email} ditambahkan (${ROLE_LABELS[res.admin.role] ?? res.admin.role})`);
      setEmail('');
      setRole('support');
      load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Gagal menambah staff');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: AdminUserRow) => {
    if (!isSuperadmin) return;
    if (!window.confirm(`${u.isActive ? 'Nonaktifkan' : 'Aktifkan'} akses admin ${u.email ?? u.userId}?`)) return;
    setErr(null);
    setOk(null);
    try {
      await adminApi.patchAdminUser(u.userId, { isActive: !u.isActive });
      setOk(`Status ${u.email ?? u.userId} diubah`);
      load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Gagal ubah status');
    }
  };

  const changeRole = async (u: AdminUserRow, nextRole: string) => {
    if (!isSuperadmin) return;
    setErr(null);
    setOk(null);
    try {
      await adminApi.patchAdminUser(u.userId, { role: nextRole });
      setOk(`Role ${u.email ?? u.userId} → ${ROLE_LABELS[nextRole] ?? nextRole}`);
      load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Gagal ubah role');
    }
  };

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Staff Admin</h2>
        <p className="muted">
          Kelola akses dashboard. Hanya superadmin yang bisa menambah/mengubah staff. Email harus sudah
          pernah login (Google) di aplikasi Profitku.
        </p>
      </div>

      {err && <p className="err">{err}</p>}
      {ok && <p className="ok">{ok}</p>}

      {isSuperadmin && (
        <form className="card stack" onSubmit={(e) => void create(e)}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Tambah staff baru</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <label className="stack" style={{ flex: '1 1 240px' }}>
              <span className="muted">Email (Google account)</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </label>
            <label className="stack" style={{ flex: '1 1 160px' }}>
              <span className="muted">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" disabled={busy} style={{ alignSelf: 'flex-end' }}>
              {busy ? 'Menyimpan…' : 'Tambah staff'}
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Ditambahkan</th>
              {isSuperadmin && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isSuperadmin ? 5 : 4} className="muted">
                  Belum ada staff (selain ADMIN_EMAILS di Worker env)
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.userId}>
                  <td>
                    {u.email ?? <code>{u.userId.slice(0, 8)}…</code>}
                    {u.name && <div style={{ fontSize: 12 }}>{u.name}</div>}
                  </td>
                  <td>
                    {isSuperadmin ? (
                      <select value={u.role} onChange={(e) => void changeRole(u, e.target.value)}>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABELS[u.role] ?? u.role
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? 'ok' : 'warn'}`}>
                      {u.isActive ? 'aktif' : 'nonaktif'}
                    </span>
                  </td>
                  <td className="muted">{new Date(u.createdAt).toLocaleString('id-ID')}</td>
                  {isSuperadmin && (
                    <td>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void toggleActive(u)}
                        disabled={u.userId === me?.userId}
                        title={u.userId === me?.userId ? 'Tidak bisa menonaktifkan diri sendiri' : undefined}
                      >
                        {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

