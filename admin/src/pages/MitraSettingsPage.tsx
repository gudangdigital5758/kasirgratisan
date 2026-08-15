import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { useAutoRefresh, refreshStamp } from '../lib/use-auto-refresh';

const emptyCfg = { enabled: true, tiers: ['20', '5', '3', '2', '1'], attribution_days: '', min_amount_idr: '' };

const toNum = (v: string, fallback = 0, min = 0, max = Infinity) => {
  const n = Number(v.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

/** Pengaturan program Mitra: skema komisi + atribusi + min payout + template link. */
export default function MitraSettingsPage() {
  const [cfg, setCfg] = useState(emptyCfg);
  const [linksReferral, setLinksReferral] = useState('');
  const [capabilities, setCapabilities] = useState({ canWritePlatformSettings: false });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .affiliateSettings()
      .then((r) =>
        setCfg({
          enabled: r.settings.enabled,
          tiers: (r.settings.tiers?.length ? r.settings.tiers : [r.settings.commission_percent]).map(String),
          attribution_days: String(r.settings.attribution_days),
          min_amount_idr: String(r.settings.min_amount_idr),
        }),
      )
      .catch(() => setErr('Gagal memuat settings komisi'));
    adminApi
      .settings()
      .then((r) => {
        const links = (r.settings as Record<string, unknown> | undefined)?.links as
          | { referral?: string }
          | undefined;
        setLinksReferral(typeof links?.referral === 'string' ? links.referral : '');
        setCapabilities(
          r.capabilities || { canWritePlatformSettings: false },
        );
        setLastSync(refreshStamp());
      })
      .catch(() => setErr('Gagal memuat pengaturan platform'));
  }, []);

  useEffect(() => {
    document.title = 'Pengaturan Mitra · Profitku Admin';
    load();
  }, [load]);

  // Auto-refresh: perubahan dari tab lain langsung terlihat.
  useAutoRefresh(load, 60_000);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await adminApi.patchAffiliateSettings({
        enabled: cfg.enabled,
        tiers: cfg.tiers.map((t) => toNum(t, 0, 0, 100)),
        attribution_days: toNum(cfg.attribution_days, 3650, 1, 3650),
        min_amount_idr: toNum(cfg.min_amount_idr, 0, 0),
      });
      setCfg({
        enabled: res.settings.enabled,
        tiers: (res.settings.tiers?.length ? res.settings.tiers : [res.settings.commission_percent]).map(String),
        attribution_days: String(res.settings.attribution_days),
        min_amount_idr: String(res.settings.min_amount_idr),
      });
      setMsg('Settings komisi disimpan.');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal simpan settings');
    } finally {
      setBusy(false);
    }
  };

  const saveLinks = async () => {
    if (!capabilities.canWritePlatformSettings || !linksReferral.includes('%s')) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await adminApi.patchSettings({ links: { referral: linksReferral } });
      setMsg('Template link referral disimpan.');
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal menyimpan template link');
    } finally {
      setBusy(false);
    }
  };

  const tierValues = cfg.tiers.map((t) => toNum(t, 0, 0, 100));
  const totalTiersPercent = tierValues.reduce((s, n) => s + n, 0);
  const canWrite = capabilities.canWritePlatformSettings;


  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Pengaturan Mitra</h2>
      <p className="muted" style={{ margin: 0 }}>
        Skema komisi, atribusi, minimal payout, dan template link referral.
        {lastSync ? ` · refresh ${lastSync}` : ''}
      </p>

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}

      <form className="card stack" onSubmit={(e) => void saveSettings(e)}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Skema komisi</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          {cfg.tiers.map((t, i) => (
            <label key={i} className="stack" style={{ flex: '0 1 110px' }}>
              <span className="muted">Tier {i + 1} (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={t}
                disabled={!canWrite}
                onChange={(e) =>
                  setCfg((s) => ({ ...s, tiers: s.tiers.map((x, j) => (j === i ? e.target.value : x)) }))
                }
                placeholder="0"
              />
            </label>
          ))}
          <label className="stack" style={{ flex: '0 1 150px' }}>
            <span className="muted">Atribusi (hari)</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={cfg.attribution_days}
              disabled={!canWrite}
              onChange={(e) => setCfg((s) => ({ ...s, attribution_days: e.target.value }))}
              placeholder="3650"
            />
          </label>
          <label className="stack" style={{ flex: '0 1 170px' }}>
            <span className="muted">Min payout (Rp)</span>
            <input
              type="number"
              min={0}
              value={cfg.min_amount_idr}
              disabled={!canWrite}
              onChange={(e) => setCfg((s) => ({ ...s, min_amount_idr: e.target.value }))}
              placeholder="50000"
            />
          </label>
          <label className="stack" style={{ flex: '0 1 150px' }}>
            <span className="muted">Program aktif</span>
            <select
              value={cfg.enabled ? '1' : '0'}
              disabled={!canWrite}
              onChange={(e) => setCfg((s) => ({ ...s, enabled: e.target.value === '1' }))}
            >
              <option value="1">Ya</option>
              <option value="0">Tidak</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.75rem', maxWidth: 640 }}>
          <b>Komisi 5 tier</b> (persen dari nominal pembayaran): tier 1 = referrer langsung,
          tier 2–5 = ancestor di atasnya. Set 0 untuk menonaktifkan tier tertentu. Total maks{' '}
          <b>
            {totalTiersPercent}% ({tierValues.join('+')})
          </b>
          . <b>Atribusi (hari):</b> masa berlaku jalur referral — user harus berlangganan dalam X
          hari sejak mengklik link, kalau lewat komisi tidak berlaku.
        </p>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="btn" disabled={busy || !canWrite}>
            {busy ? 'Menyimpan…' : 'Simpan settings komisi'}
          </button>
        </div>
      </form>


      <div className="card stack">
        <strong>Link Referral (template)</strong>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Template URL undangan Mitra — <code>%s</code> diganti kode REF. Dibaca worker
          (<code>/api/affiliate/me</code>, <code>/claim</code>) dan halaman Mitra admin.
          Ubah di sini tanpa deploy.
        </p>
        <input
          type="text"
          value={linksReferral}
          disabled={!canWrite}
          onChange={(e) => setLinksReferral(e.target.value)}
          placeholder="https://profitku.my.id/join?ref=%s"
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={() => void saveLinks()}
          disabled={busy || !canWrite || !linksReferral.includes('%s')}
          style={{
            padding: '8px 16px',
            background: 'var(--ok)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          {busy ? 'Menyimpan…' : 'Simpan template link'}
        </button>
      </div>
    </div>
  );
}
