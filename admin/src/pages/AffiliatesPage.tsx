import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AffiliateRow,
} from '../lib/api';
import { useAutoRefresh, refreshStamp } from '../lib/use-auto-refresh';

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

export default function AffiliatesPage() {
  const [linksTpl, setLinksTpl] = useState<string | null>(null);
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [q, setQ] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  // Feedback tombol aksi per mitra: busy + status sukses sementara.
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState<Record<string, boolean>>({});
  const [toggleDone, setToggleDone] = useState<Record<string, boolean>>({});
  const [minInputs, setMinInputs] = useState<Record<string, string>>({});
  const [minDone, setMinDone] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setErr(null);
    adminApi
      .affiliates()
      .then((r) => {
        setRows(r.affiliates);
        setLastSync(refreshStamp());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat affiliates'));
  }, []);

  const loadSettings = useCallback(() => {
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

  // Auto-refresh: fokus tab + setiap 60 detik (komisi/counter mitra selalu segar).
  useAutoRefresh(load, 60_000);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateBusy(true);
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
      setCreateBusy(false);
    }
  };

  /** Toggle aktif/nonaktif dengan feedback tombol (Disabled/Enabled). */
  const toggleActive = async (a: AffiliateRow) => {
    setActionBusy(`toggle:${a.id}`);
    setErr(null);
    setOk(null);
    try {
      await adminApi.patchAffiliate(a.id, { isActive: !a.isActive });
      setToggleDone((m) => ({ ...m, [a.id]: true }));
      setTimeout(() => setToggleDone((m) => ({ ...m, [a.id]: false })), 1500);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal update');
    } finally {
      setActionBusy(null);
    }
  };

  /** Tandai paid dipindah ke halaman Komisi Affiliate (panel Per Affiliator). */

  /** Simpan override min payout per mitra (kosong = ikut global). */
  const saveMinPayout = async (a: AffiliateRow) => {
    const raw = (minInputs[a.id] ?? '').trim();
    const n = raw === '' ? null : Math.floor(Number(raw));
    if (raw !== '' && (n === null || !Number.isFinite(n) || n < 0)) {
      setErr('Min payout harus angka >= 0 atau kosong (ikut global)');
      return;
    }
    setActionBusy(`min:${a.id}`);
    setErr(null);
    setOk(null);
    try {
      await adminApi.patchAffiliate(a.id, { minAmountIdr: n });
      setMinDone((m) => ({ ...m, [a.id]: true }));
      setTimeout(() => setMinDone((m) => ({ ...m, [a.id]: false })), 1500);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Gagal simpan min payout');
    } finally {
      setActionBusy(null);
    }
  };

  /** Salin link dengan feedback tombol (Disalin). */
  const copyLinkFor = async (a: AffiliateRow) => {
    setActionBusy(`copy:${a.id}`);
    await copyText(refLink(a.code));
    setActionBusy(null);
    setCopyDone((m) => ({ ...m, [a.id]: true }));
    setTimeout(() => setCopyDone((m) => ({ ...m, [a.id]: false })), 1500);
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

      {/* Buat affiliator (settings komisi ada di menu Pengaturan Mitra) */}
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
          <button type="submit" className="btn" disabled={createBusy}>
            {createBusy ? 'Menyimpan…' : 'Buat affiliator'}
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
        <span className="muted">{filtered.length} affiliator{lastSync ? ` · refresh ${lastSync}` : ''}</span>
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
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input
                    type="number"
                    min={0}
                    placeholder="Min payout (kosong = global)"
                    style={{ fontSize: 12, padding: '4px 6px', width: 150 }}
                    value={minInputs[a.id] ?? (a.minAmountIdr ?? '')}
                    disabled={actionBusy !== null}
                    onChange={(e) => setMinInputs((m) => ({ ...m, [a.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    disabled={actionBusy !== null}
                    onClick={() => void saveMinPayout(a)}
                  >
                    {minDone[a.id]
                      ? 'Tersimpan'
                      : actionBusy === `min:${a.id}`
                        ? '...'
                        : 'Atur'}
                  </button>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={actionBusy !== null}
                    onClick={() => void copyLinkFor(a)}
                  >
                    {copyDone[a.id]
                      ? 'Disalin'
                      : actionBusy === `copy:${a.id}`
                        ? '...'
                        : '📋 Salin link'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={actionBusy !== null}
                    onClick={() => void toggleActive(a)}
                  >
                    {actionBusy === `toggle:${a.id}`
                      ? '...'
                      : toggleDone[a.id]
                        ? a.isActive
                          ? 'Enabled'
                          : 'Disabled'
                        : a.isActive
                          ? 'Disable'
                          : 'Enable'}
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
