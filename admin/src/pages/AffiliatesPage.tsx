import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AffiliateRow,
  type AffiliateSettings,
} from '../lib/api';

const defaultSettings: AffiliateSettings = {
  enabled: true,
  commission_percent: 10,
  tiers: [20, 5, 3, 2, 1],
  attribution_days: 3650,
  min_amount_idr: 0,
};

const emptyForm = {
  code: '',
  name: '',
  userEmail: '',
  referredByCode: '',
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
  payoutNote: '',
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/** Field angka disimpan sebagai string agar bisa dikosongkan (tanpa paksa 0 / leading zero). */
const emptyCfg = { enabled: true, tiers: ['20', '5', '3', '2', '1'], attribution_days: '', min_amount_idr: '' };

const toNum = (v: string, fallback = 0, min = 0, max = Infinity) => {
  const n = Number(v.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export default function AffiliatesPage() {
  const [cfg, setCfg] = useState(emptyCfg);
  const [linksTpl, setLinksTpl] = useState<string | null>(null);
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setErr(null);
    adminApi
      .affiliates()
      .then((r) => setRows(r.affiliates))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat affiliates'));
  }, []);

  const loadSettings = useCallback(() => {
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
      .catch(() => setCfg({ ...emptyCfg, enabled: defaultSettings.enabled }));
    // Template link referral dari platform_settings['links'] (single source of truth).
    adminApi
      .settings()
      .then((r) => {
        const links = (r.settings as Record<string, unknown> | undefined)?.links as
          | { referral?: string }
          | undefined;
        setLinksTpl(
          typeof links?.referral === 'string' && links.referral.includes('%s') ? links.referral : null,
        );
      })
      .catch(() => setLinksTpl(null));
  }, []);

  useEffect(() => {
    document.title = 'Mitra · Profitku Admin';
    load();
    loadSettings();
  }, [load, loadSettings]);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
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
      setOk('Settings affiliate disimpan');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal simpan settings');
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await adminApi.createAffiliate({
        code: form.code.trim() || undefined,
        name: form.name,
        userEmail: form.userEmail.trim() || undefined,
        referredByCode: form.referredByCode.trim().toUpperCase() || undefined,
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountName: form.bankAccountName,
        payoutNote: form.payoutNote,
      });
      setOk('Affiliator dibuat (kode REF otomatis bila kosong)');
      setForm(emptyForm);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal membuat affiliator');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (a: AffiliateRow) => {
    try {
      await adminApi.patchAffiliate(a.id, { isActive: !a.isActive });
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal update');
    }
  };

  /** Tandai semua komisi earned satu affiliator sebagai paid (dari kartu). */
  const markPaidFor = async (a: AffiliateRow) => {
    if (!window.confirm(`Tandai SEMUA komisi earned ${a.code} sebagai PAID?`)) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await adminApi.markAffiliatePaid(a.id);
      setOk(`${res.updated} komisi ditandai paid`);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal menandai paid');
    } finally {
      setBusy(false);
    }
  };

  const bankText = (a: AffiliateRow) => {
    const parts = [a.bankName, a.bankAccountNo, a.bankAccountName].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setOk('Link referral disalin');
      setErr(null);
    } catch {
      setErr('Gagal menyalin link');
    }
  };

  // Total komisi maks dari nilai tier yang sedang diisi (dinamis).
  const tierValues = cfg.tiers.map((t) => toNum(t, 0, 0, 100));
  const totalTiersPercent = tierValues.reduce((s, n) => s + n, 0);

  // Link referral dari template config (platform_settings['links']) — fallback kanonik.
  const refLink = (code: string) =>
    linksTpl ? linksTpl.replace('%s', code) : `https://profitku.my.id/join?ref=${code}`;

  // Filter pencarian kartu affiliator (nama/kode/email/bank/parent).
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((a) =>
        [a.name, a.code, a.userEmail, a.bankName, a.bankAccountNo, a.referredByCode]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
      )
    : rows;

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Program Mitra</h2>
        <p className="muted">
          Referral link Profitku 5 tier. User yang membuka <code>?ref=KODE</code> otomatis dikunci ke
          mitra; saat berlangganan/perpanjang cloud, komisi per tier (20/5/3/2/1%) dicatat
          otomatis dari pembayaran sukses s.d. 5 level di atasnya.
        </p>
      </div>

      {err && <p className="err">{err}</p>}
      {ok && <p className="ok">{ok}</p>}

      <form className="card stack" onSubmit={(e) => void saveSettings(e)}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Settings komisi</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          {cfg.tiers.map((t, i) => (
            <label key={i} className="stack" style={{ flex: '0 1 110px' }}>
              <span className="muted">Tier {i + 1} (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={t}
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
              onChange={(e) => setCfg((s) => ({ ...s, attribution_days: e.target.value }))}
              placeholder="3650"
            />
          </label>
          <label className="stack" style={{ flex: '0 1 170px' }}>
            <span className="muted">Min pembayaran (Rp)</span>
            <input
              type="number"
              min={0}
              value={cfg.min_amount_idr}
              onChange={(e) => setCfg((s) => ({ ...s, min_amount_idr: e.target.value }))}
              placeholder="0"
            />
          </label>
          <label className="stack" style={{ flex: '0 1 150px' }}>
            <span className="muted">Aktif</span>
            <select
              value={cfg.enabled ? '1' : '0'}
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
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan settings'}
          </button>
        </div>
      </form>

      <form className="card stack" onSubmit={(e) => void create(e)}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Buat affiliator</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="stack" style={{ flex: '1 1 150px' }}>
            <span className="muted">Kode (kosongkan = otomatis)</span>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="MITRA-BUDI"
              style={{ textTransform: 'uppercase' }}
            />
          </label>
          <label className="stack" style={{ flex: '1 1 180px' }}>
            <span className="muted">Nama affiliator</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Budi (influencer)"
            />
          </label>
          <label className="stack" style={{ flex: '1 1 220px' }}>
            <span className="muted">Email user terhubung (opsional)</span>
            <input
              value={form.userEmail}
              onChange={(e) => setForm((f) => ({ ...f, userEmail: e.target.value }))}
              placeholder="budi@gmail.com"
              type="email"
            />
          </label>
          <label className="stack" style={{ flex: '1 1 180px' }}>
            <span className="muted">Kode parent (opsional, tier di atasnya)</span>
            <input
              value={form.referredByCode}
              onChange={(e) => setForm((f) => ({ ...f, referredByCode: e.target.value.toUpperCase() }))}
              placeholder="MITRA-UTAMA"
              style={{ textTransform: 'uppercase' }}
            />
          </label>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="stack" style={{ flex: '1 1 160px' }}>
            <span className="muted">Nama bank (opsional)</span>
            <input
              value={form.bankName}
              onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
              placeholder="BCA / Mandiri / DANA"
            />
          </label>
          <label className="stack" style={{ flex: '1 1 180px' }}>
            <span className="muted">No. rekening (opsional)</span>
            <input
              value={form.bankAccountNo}
              onChange={(e) => setForm((f) => ({ ...f, bankAccountNo: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label className="stack" style={{ flex: '1 1 180px' }}>
            <span className="muted">Atas nama (opsional)</span>
            <input
              value={form.bankAccountName}
              onChange={(e) => setForm((f) => ({ ...f, bankAccountName: e.target.value }))}
              placeholder="Budi Santoso"
            />
          </label>
        </div>
        <label className="stack">
          <span className="muted">Catatan payout (opsional)</span>
          <input
            value={form.payoutNote}
            onChange={(e) => setForm((f) => ({ ...f, payoutNote: e.target.value }))}
            placeholder="Catatan tambahan: e-wallet / kontak"
          />
        </label>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Buat affiliator'}
          </button>
        </div>
      </form>

      {/* Pencarian + kartu affiliator (detail inline) */}
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 360 }}
          placeholder="Cari nama / kode / email / bank…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">{filtered.length} affiliator</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card muted">Belum ada affiliator</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {filtered.map((a) => {
            const bank = bankText(a);
            const earned = a.stats?.earnedCommissionIdr ?? 0;
            return (
              <div key={a.id} className="card stack" style={{ gap: '0.4rem' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <code>{a.code}</code>
                  <span className={`badge ${a.isActive ? 'ok' : ''}`}>
                    {a.isActive ? 'aktif' : 'nonaktif'}
                  </span>
                </div>
                <div>
                  <strong>{a.name || '—'}</strong>
                  {a.userEmail && (
                    <div className="muted" style={{ fontSize: 12 }}>{a.userEmail}</div>
                  )}
                  {a.referredByCode && (
                    <div className="muted" style={{ fontSize: 11 }}>parent: {a.referredByCode}</div>
                  )}
                </div>
                {bank && <div style={{ fontSize: 12 }}>💳 {bank}</div>}
                {a.payoutNote && <div className="muted" style={{ fontSize: 11 }}>{a.payoutNote}</div>}
                <div className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {/* Template dari platform_settings['links'] — jangan hardcode di sini */}
                  {refLink(a.code)}
                </div>
                <div className="row" style={{ gap: '1rem' }}>
                  <span style={{ fontSize: 12 }}>📥 {a.stats?.referrals ?? 0}</span>
                  <span style={{ fontSize: 12 }}>👥 {a.stats?.referredUsers ?? 0} user</span>
                  <span style={{ fontSize: 12 }}>💰 earned {rp(earned)}</span>
                  <span style={{ fontSize: 12 }}>✅ paid {rp(a.stats?.paidCommissionIdr ?? 0)}</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => void copyText(refLink(a.code))}
                  >
                    📋 Salin link
                  </button>
                  {earned > 0 && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => void markPaidFor(a)}
                    >
                      Tandai paid
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => void toggleActive(a)}
                  >
                    {a.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
