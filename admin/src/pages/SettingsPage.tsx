import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { useAdminAuth } from '../lib/auth';

export default function SettingsPage() {
  const { me } = useAdminAuth();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    adminApi
      .settings()
      .then((r) => {
        setSettings(r.settings || {});
        setHealth(r.health || {});
        setNote(r.secretsNote || '');
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  };

  useEffect(() => {
    document.title = 'Platform · Profitku Admin';
    load();
  }, []);

  const maintenance = Boolean(settings.maintenance_mode);
  const dunning = settings.dunning_enabled !== false;

  const save = async (patch: Record<string, unknown>) => {
    setMsg(null);
    try {
      await adminApi.patchSettings(patch);
      setMsg('Tersimpan');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal simpan');
    }
  };

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Platform settings</h2>
        <p className="muted">Feature flags operasional — bukan secrets provider</p>
      </div>

      {err && <p className="err">{err}</p>}
      {msg && <p className="muted">{msg}</p>}

      <div className="card stack">
        <strong>Health</strong>
        <pre style={{ margin: 0, fontSize: 12, background: '#f8fafc', padding: 8, borderRadius: 8 }}>
          {JSON.stringify(health, null, 2)}
        </pre>
        <p className="muted">{note}</p>
      </div>

      <div className="card stack">
        <strong>Flags</strong>
        <label className="row">
          <input
            type="checkbox"
            checked={maintenance}
            disabled={me?.role === 'readonly'}
            onChange={(e) => void save({ maintenance_mode: e.target.checked })}
          />
          Maintenance mode
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={dunning}
            disabled={me?.role === 'readonly'}
            onChange={(e) => void save({ dunning_enabled: e.target.checked })}
          />
          Dunning enabled
        </label>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Deploy admin ke <code>dashboard.profitku.my.id</code>. Set Worker secrets:{' '}
          <code>ADMIN_EMAILS</code>, <code>ADMIN_ORIGIN</code>. Jalankan migrasi{' '}
          <code>20260724000000_admin_ops.sql</code>.
        </p>
      </div>
    </div>
  );
}
