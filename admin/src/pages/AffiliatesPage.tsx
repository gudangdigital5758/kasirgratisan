import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AffiliateRow,
  type AffiliateCommission,
  type AffiliateSettings,
} from '../lib/api';

const defaultSettings: AffiliateSettings = {
  enabled: true,
  commission_percent: 10,
  attribution_days: 90,
  min_amount_idr: 0,
};

const emptyForm = {
  code: '',
  name: '',
  userEmail: '',
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
  payoutNote: '',
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/** Field angka disimpan sebagai string agar bisa dikosongkan (tanpa paksa 0 / leading zero). */
const emptyCfg = { enabled: true, commission_percent: '', attribution_days: '', min_amount_idr: '' };

const toNum = (v: string, fallback = 0, min = 0, max = Infinity) => {
  const n = Number(v.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export default function AffiliatesPage() {
  const [cfg, setCfg] = useState(emptyCfg);
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ affiliate: AffiliateRow; commissions: AffiliateCommission[] } | null>(null);

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
          commission_percent: String(r.settings.commission_percent),
          attribution_days: String(r.settings.attribution_days),
          min_amount_idr: String(r.settings.min_amount_idr),
        }),
      )
      .catch(() => setCfg({ ...emptyCfg, enabled: defaultSettings.enabled }));
  }, []);

  useEffect(() => {
    document.title = 'Affiliates · Profitku Admin';
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
        commission_percent: toNum(cfg.commission_percent, 0, 0, 100),
        attribution_days: toNum(cfg.attribution_days, 90, 1, 3650),
        min_amount_idr: toNum(cfg.min_amount_idr, 0, 0),
      });
      setCfg({
        enabled: res.settings.enabled,
        commission_percent: String(res.settings.commission_percent),
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
        code: form.code,
        name: form.name,
        userEmail: form.userEmail.trim() || undefined,
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountName: form.bankAccountName,
        payoutNote: form.payoutNote,
      });
      setOk(`Affiliator ${form.code.toUpperCase()} dibuat — link: https://profitku.my.id/?ref=${form.code.toUpperCase()}`);
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

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    try {
      const d = await adminApi.affiliate(id);
      setDetail(d);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal detail');
    }
  };

  const markPaid = async () => {
    if (!detailId) return;
    if (!window.confirm('Tandai SEMUA komisi earned affiliator ini sebagai PAID?')) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await adminApi.markAffiliatePaid(detailId);
      setOk(`${res.updated} komisi ditandai paid`);
      if (detailId) await openDetail(detailId);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal menandai paid');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (s: string) =>
    s === 'paid' ? 'paid' : s === 'void' ? 'void' : 'earned';

  const bankText = (a: AffiliateRow) => {
    const parts = [a.bankName, a.bankAccountNo, a.bankAccountName].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Affiliate</h2>
        <p className="muted">
          Referral link Profitku. User yang membuka <code>?ref=KODE</code> otomatis dikunci ke
          affiliator; saat berlangganan/perpanjang cloud, komisi <b>N%</b> dicatat otomatis dari
          pembayaran sukses.
        </p>
      </div>

      {err && <p className="err">{err}</p>}
      {ok && <p className="ok">{ok}</p>}

      <form className="card stack" onSubmit={(e) => void saveSettings(e)}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Settings komisi</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="stack" style={{ flex: '0 1 160px' }}>
            <span className="muted">Komisi (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={cfg.commission_percent}
              onChange={(e) => setCfg((s) => ({ ...s, commission_percent: e.target.value }))}
              placeholder="10"
            />
          </label>
          <label className="stack" style={{ flex: '0 1 150px' }}>
            <span className="muted">Atribusi (hari)</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={cfg.attribution_days}
              onChange={(e) => setCfg((s) => ({ ...s, attribution_days: e.target.value }))}
              placeholder="90"
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
          <b>Atribusi (hari):</b> masa berlaku jalur referral — user harus berlangganan dalam X hari
          sejak mengklik link affiliator, kalau lewat komisi tidak berlaku. Kosongkan Komisi (%) lalu
          simpan untuk komisi 0 (jalur referral tetap terekam).
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
            <span className="muted">Kode (4–24, A-Z0-9_-)</span>
            <input
              required
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

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Kode / Nama</th>
              <th>Bank</th>
              <th>Referral</th>
              <th>Komisi (earned)</th>
              <th>Komisi (paid)</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Belum ada affiliator
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const bank = bankText(a);
                return (
                  <tr key={a.id}>
                    <td>
                      <code>{a.code}</code>
                      <div>{a.name}</div>
                      {a.payoutNote && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {a.payoutNote}
                        </div>
                      )}
                    </td>
                    <td>
                      {bank ? (
                        <div style={{ fontSize: 12 }}>{bank}</div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {a.stats?.referrals ?? 0}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {a.stats?.referredUsers ?? 0} user
                      </div>
                    </td>
                  <td>{rp(a.stats?.earnedCommissionIdr ?? 0)}</td>
                  <td>{rp(a.stats?.paidCommissionIdr ?? 0)}</td>
                  <td>
                    <span className={`badge ${a.isActive ? 'ok' : ''}`}>
                      {a.isActive ? 'aktif' : 'nonaktif'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn ghost" onClick={() => void openDetail(a.id)}>
                      Komisi
                    </button>{' '}
                    <button type="button" className="btn ghost" onClick={() => void toggleActive(a)}>
                      {a.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {detailId && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>
              Komisi — <code>{detail?.affiliate.code}</code> {detail?.affiliate.name}
            </h3>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button type="button" className="btn ghost" onClick={() => setDetailId(null)}>
                Tutup
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void markPaid()}>
                {busy ? '…' : 'Tandai semua paid'}
              </button>
            </div>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Link: <code>https://profitku.my.id/?ref={detail?.affiliate.code}</code>
          </p>
          {detail?.affiliate && bankText(detail.affiliate) && (
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              💳 Bank: {bankText(detail.affiliate)}
              {detail.affiliate.payoutNote ? ` · Catatan: ${detail.affiliate.payoutNote}` : ''}
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Payment</th>
                  <th>Dibayar</th>
                  <th>Rate</th>
                  <th>Komisi</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.commissions.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Belum ada komisi
                    </td>
                  </tr>
                ) : (
                  detail!.commissions.map((cm) => (
                    <tr key={cm.id}>
                      <td className="muted">{new Date(cm.createdAt).toLocaleString('id-ID')}</td>
                      <td>
                        <code>{cm.paymentId.slice(0, 8)}</code>
                      </td>
                      <td>{rp(cm.amountPaid)}</td>
                      <td>{cm.ratePercent}%</td>
                      <td>
                        <b>{rp(cm.commissionIdr)}</b>
                      </td>
                      <td>
                        <span className={`badge ${cm.status === 'paid' ? 'ok' : ''}`}>
                          {statusLabel(cm.status)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
