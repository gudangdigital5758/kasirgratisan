import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { useAdminAuth } from '../lib/auth';

interface ActionButtonConfig {
  enabled: boolean;
  url?: string;
  label?: {
    id: string;
    en: string;
    ms: string;
  };
}

interface ActionButtonsValue {
  whatsNew?: ActionButtonConfig;
  requestFeature?: ActionButtonConfig;
  donate?: ActionButtonConfig;
  telegram?: ActionButtonConfig;
}

export default function SettingsPage() {
  const { me } = useAdminAuth();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Action buttons config
  const [actionButtons, setActionButtons] = useState<ActionButtonsValue>({
    whatsNew: { enabled: true },
    requestFeature: { enabled: true, url: 'https://t.me/profitku' },
    donate: { enabled: true, url: 'mailto:support@profitku.my.id' },
    telegram: { enabled: true, url: 'https://t.me/profitku' },
  });
  const [actionButtonsLoading, setActionButtonsLoading] = useState(false);

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

  const loadActionButtons = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.profitku.my.id'}/api/app-settings/action_buttons`);
      if (res.ok) {
        const data = await res.json();
        if (data.value) {
          setActionButtons(data.value as ActionButtonsValue);
        }
      }
    } catch (e) {
      console.warn('[load action_buttons]', e);
    }
  };

  // Normalize payload before save: whatsNew doesn't need url
  const normalizeActionButtons = (buttons: ActionButtonsValue): ActionButtonsValue => {
    const normalized = { ...buttons };
    
    // whatsNew only needs enabled flag (opens modal, not external link)
    if (normalized.whatsNew) {
      const { enabled } = normalized.whatsNew;
      normalized.whatsNew = { enabled, url: '' };
    }
    
    // Other buttons need url as string
    ['requestFeature', 'donate', 'telegram'].forEach((key) => {
      const btn = normalized[key as keyof ActionButtonsValue];
      if (btn && typeof btn === 'object') {
        if (typeof (btn as { url?: string }).url !== 'string') {
          (btn as { url: string }).url = '';
        }
      }
    });
    
    return normalized;
  };

  useEffect(() => {
    document.title = 'Platform · Profitku Admin';
    load();
    void loadActionButtons();
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

  const saveActionButtons = async () => {
    setActionButtonsLoading(true);
    setMsg(null);
    setErr(null);
    try {
      const normalized = normalizeActionButtons(actionButtons);
      await adminApi.updateAppSetting('action_buttons', normalized);
      setMsg('Action buttons tersimpan');
      await loadActionButtons();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal simpan action buttons');
    } finally {
      setActionButtonsLoading(false);
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

      <div className="card stack">
        <strong>Action Buttons (Settings Page)</strong>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Kontrol tombol aksi di halaman Settings → About section (app frontend)
        </p>

        {/* What's New */}
        <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={actionButtons.whatsNew?.enabled ?? true}
              disabled={me?.role === 'readonly'}
              onChange={(e) =>
                setActionButtons((prev) => ({
                  ...prev,
                  whatsNew: { ...prev.whatsNew, enabled: e.target.checked },
                }))
              }
            />
            <strong>Yang Baru di Profitku</strong> (What's New modal)
          </label>
        </div>

        {/* Request Feature */}
        <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={actionButtons.requestFeature?.enabled ?? true}
              disabled={me?.role === 'readonly'}
              onChange={(e) =>
                setActionButtons((prev) => ({
                  ...prev,
                  requestFeature: { ...prev.requestFeature, enabled: e.target.checked },
                }))
              }
            />
            <strong>💡 Request Fitur</strong>
          </label>
          <input
            type="url"
            placeholder="URL (e.g. https://t.me/profitku)"
            value={actionButtons.requestFeature?.url || ''}
            disabled={me?.role === 'readonly'}
            onChange={(e) =>
              setActionButtons((prev) => ({
                ...prev,
                requestFeature: { 
                  enabled: prev.requestFeature?.enabled ?? true, 
                  ...prev.requestFeature, 
                  url: e.target.value 
                },
              }))
            }
            style={{
              width: '100%',
              marginTop: 8,
              padding: '8px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
            }}
          />
        </div>

        {/* Donate */}
        <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={actionButtons.donate?.enabled ?? true}
              disabled={me?.role === 'readonly'}
              onChange={(e) =>
                setActionButtons((prev) => ({
                  ...prev,
                  donate: { ...prev.donate, enabled: e.target.checked },
                }))
              }
            />
            <strong>☕ Traktir Kopi untuk Developer</strong>
          </label>
          <input
            type="url"
            placeholder="URL (e.g. mailto:support@profitku.my.id)"
            value={actionButtons.donate?.url || ''}
            disabled={me?.role === 'readonly'}
            onChange={(e) =>
              setActionButtons((prev) => ({
                ...prev,
                donate: { 
                  enabled: prev.donate?.enabled ?? true, 
                  ...prev.donate, 
                  url: e.target.value 
                },
              }))
            }
            style={{
              width: '100%',
              marginTop: 8,
              padding: '8px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
            }}
          />
        </div>

        {/* Telegram */}
        <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={actionButtons.telegram?.enabled ?? true}
              disabled={me?.role === 'readonly'}
              onChange={(e) =>
                setActionButtons((prev) => ({
                  ...prev,
                  telegram: { ...prev.telegram, enabled: e.target.checked },
                }))
              }
            />
            <strong>💬 Gabung Grup Telegram</strong>
          </label>
          <input
            type="url"
            placeholder="URL (e.g. https://t.me/profitku)"
            value={actionButtons.telegram?.url || ''}
            disabled={me?.role === 'readonly'}
            onChange={(e) =>
              setActionButtons((prev) => ({
                ...prev,
                telegram: { 
                  enabled: prev.telegram?.enabled ?? true, 
                  ...prev.telegram, 
                  url: e.target.value 
                },
              }))
            }
            style={{
              width: '100%',
              marginTop: 8,
              padding: '8px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
            }}
          />
        </div>

        {me?.role !== 'readonly' && (
          <button
            onClick={() => void saveActionButtons()}
            disabled={actionButtonsLoading}
            style={{
              padding: '10px 20px',
              background: actionButtonsLoading ? '#94a3b8' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: actionButtonsLoading ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {actionButtonsLoading ? 'Menyimpan...' : 'Simpan Action Buttons'}
          </button>
        )}
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
