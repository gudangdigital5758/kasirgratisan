import { useCallback, useEffect, useState } from 'react';
import { adminApi, type VoucherRow } from '../lib/api';

const emptyForm = {
  code: '',
  type: 'percent' as 'percent' | 'free_days' | 'lifetime',
  value: 50,
  maxRedemptions: '' as string | number,
  maxPerUser: 1,
  endsAt: '',
  note: '',
  isActive: true,
};

export default function VouchersPage() {
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<
    Array<{
      id: string;
      user_id: string;
      amount_before: number | null;
      amount_after: number | null;
      redeemed_at: string;
      effect?: Record<string, unknown>;
    }>
  >([]);

  const load = useCallback(() => {
    setErr(null);
    adminApi
      .vouchers()
      .then((r) => setRows(r.vouchers))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat'));
  }, []);

  useEffect(() => {
    document.title = 'Vouchers · Profitku Admin';
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const value =
        form.type === 'lifetime' ? 0 : form.type === 'percent' ? Number(form.value) : Number(form.value);
      await adminApi.createVoucher({
        code: form.code,
        type: form.type,
        value,
        maxRedemptions:
          form.maxRedemptions === '' || form.maxRedemptions == null
            ? null
            : Number(form.maxRedemptions),
        maxPerUser: Number(form.maxPerUser) || 1,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        note: form.note || null,
        isActive: form.isActive,
        planId: 'cloud_monthly',
      });
      setOk(`Voucher ${form.code.toUpperCase()} dibuat`);
      setForm(emptyForm);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal membuat');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (v: VoucherRow) => {
    try {
      await adminApi.patchVoucher(v.id, { isActive: !v.is_active });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal update');
    }
  };

  const removeVoucher = async (v: VoucherRow) => {
    const count = v.redemptionCount ?? 0;
    const msg =
      count === 0
        ? `Hapus permanen kode ${v.code}? (belum ada klaim)`
        : `Kode ${v.code} sudah diklaim ${count}×.\n\nOK = soft-delete (nonaktifkan, riwayat tetap)\nCancel = batal`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await adminApi.deleteVoucher(v.id);
      setOk(res.message || (res.mode === 'hard' ? 'Dihapus permanen' : 'Dinonaktifkan (soft-delete)'));
      if (detailId === v.id) {
        setDetailId(null);
        setRedemptions([]);
      }
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal hapus');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    try {
      const d = await adminApi.voucher(id);
      setRedemptions((d.redemptions || []) as typeof redemptions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal detail');
    }
  };

  const typeLabel = (t: string, value: number) => {
    if (t === 'lifetime') return 'Seumur hidup';
    if (t === 'free_days') return `+${value} hari`;
    return `${value}% off`;
  };

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Vouchers</h2>
        <p className="muted">
          Promo cloud: diskon %, hari gratis, atau lifetime. Hapus: permanen jika 0 klaim; soft-delete
          (nonaktif) jika sudah diklaim.
        </p>
      </div>
      {err && <p className="err">{err}</p>}
      {ok && <p className="ok">{ok}</p>}

      <form className="card stack" onSubmit={(e) => void create(e)}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Buat kode</h3>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="stack" style={{ flex: '1 1 140px' }}>
            <span className="muted">Kode</span>
            <input
              required
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="KELUARGA-DANIEL"
              style={{ textTransform: 'uppercase' }}
            />
          </label>
          <label className="stack" style={{ flex: '1 1 140px' }}>
            <span className="muted">Tipe</span>
            <select
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as typeof form.type;
                setForm((f) => ({
                  ...f,
                  type,
                  value: type === 'lifetime' ? 0 : type === 'free_days' ? 30 : 50,
                }));
              }}
            >
              <option value="percent">Diskon %</option>
              <option value="free_days">Hari gratis</option>
              <option value="lifetime">Lifetime (VIP)</option>
            </select>
          </label>
          {form.type !== 'lifetime' && (
            <label className="stack" style={{ flex: '0 1 100px' }}>
              <span className="muted">{form.type === 'percent' ? 'Persen' : 'Hari'}</span>
              <input
                type="number"
                min={1}
                max={form.type === 'percent' ? 100 : 3650}
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))}
              />
            </label>
          )}
          <label className="stack" style={{ flex: '0 1 100px' }}>
            <span className="muted">Max global</span>
            <input
              type="number"
              min={1}
              placeholder="∞"
              value={form.maxRedemptions}
              onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))}
            />
          </label>
          <label className="stack" style={{ flex: '0 1 90px' }}>
            <span className="muted">Per user</span>
            <input
              type="number"
              min={1}
              value={form.maxPerUser}
              onChange={(e) => setForm((f) => ({ ...f, maxPerUser: Number(e.target.value) || 1 }))}
            />
          </label>
          <label className="stack" style={{ flex: '1 1 160px' }}>
            <span className="muted">Berakhir (opsional)</span>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </label>
        </div>
        <label className="stack">
          <span className="muted">Catatan internal</span>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Family VIP · soft launch · influencer X"
          />
        </label>
        <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Buat voucher'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setForm({
                ...emptyForm,
                code: 'FAMILY',
                type: 'lifetime',
                value: 0,
                maxRedemptions: 5,
                maxPerUser: 1,
                note: 'Lifetime family/friends',
              })
            }
          >
            Template lifetime
          </button>
        </div>
      </form>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Efek</th>
              <th>Kuota</th>
              <th>Status</th>
              <th>Dibuat</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada voucher
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <code>{v.code}</code>
                    {v.note && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {v.note}
                      </div>
                    )}
                  </td>
                  <td>{typeLabel(v.type, v.value)}</td>
                  <td>
                    {v.redemptionCount ?? 0}
                    {v.max_redemptions != null ? ` / ${v.max_redemptions}` : ' / ∞'}
                    <div className="muted" style={{ fontSize: 11 }}>
                      max {v.max_per_user}/user
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${v.is_active ? 'ok' : ''}`}>
                      {v.is_active ? 'aktif' : 'nonaktif'}
                    </span>
                  </td>
                  <td className="muted">{new Date(v.created_at).toLocaleString('id-ID')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn ghost" onClick={() => void openDetail(v.id)}>
                      Usage
                    </button>{' '}
                    <button type="button" className="btn ghost" onClick={() => void toggleActive(v)}>
                      {v.is_active ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ color: 'var(--danger)' }}
                      disabled={busy}
                      onClick={() => void removeVoucher(v)}
                      title={
                        (v.redemptionCount ?? 0) === 0
                          ? 'Hapus permanen (belum ada klaim)'
                          : 'Soft-delete: nonaktifkan (ada klaim)'
                      }
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailId && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Redemptions</h3>
            <button type="button" className="btn ghost" onClick={() => setDetailId(null)}>
              Tutup
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>User</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {redemptions.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    Belum ada klaim
                  </td>
                </tr>
              ) : (
                redemptions.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{new Date(r.redeemed_at).toLocaleString('id-ID')}</td>
                    <td>
                      <a href={`/members/${r.user_id}`} style={{ color: '#ea580c' }}>
                        {r.user_id.slice(0, 8)}…
                      </a>
                    </td>
                    <td>
                      {r.amount_before != null && r.amount_after != null
                        ? `Rp ${r.amount_before.toLocaleString('id-ID')} → Rp ${r.amount_after.toLocaleString('id-ID')}`
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
