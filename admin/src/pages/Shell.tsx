import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '../lib/auth';
import { useAdminTheme } from '../lib/theme';

const links = [
  { to: '/', end: true, label: 'Overview' },
  { to: '/members', label: 'Members' },
  { to: '/payments', label: 'Payments' },
  { to: '/vouchers', label: 'Vouchers' },
  { to: '/affiliates', label: 'Affiliates' },
  { to: '/events', label: 'Events / Live log' },
  { to: '/settings', label: 'Platform' },
];

export default function Shell() {
  const { me, logout } = useAdminAuth();
  const { dark, toggle } = useAdminTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Tutup drawer saat pindah halaman (mobile).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Tutup dengan tombol Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="layout">
      {/* Topbar mobile — hamburger + brand */}
      <header className="topbar">
        <button
          type="button"
          className="hamburger"
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          aria-expanded={open}
        >
          <span />
          <span />
          <span />
        </button>
        <img src="/profitku-lockup.png" alt="Profitku" className="brand-logo" />
        <span className="topbar-title">Profitku Admin</span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggle}
          aria-label={dark ? 'Mode terang' : 'Mode gelap'}
          title={dark ? 'Mode terang' : 'Mode gelap'}
        >
          {dark ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Backdrop (mobile) */}
      {open && <div className="backdrop" onClick={close} aria-hidden="true" />}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-head">
          <div className="brand-head">
            <img src="/profitku-lockup.png" alt="Profitku" className="brand-logo" />
            <h1>Profitku Admin</h1>
          </div>
          <button type="button" className="sidebar-close" onClick={close} aria-label="Tutup menu">
            ×
          </button>
        </div>
        <p className="sub">
          {me?.email}
          <br />
          <span className="badge" style={{ marginTop: 6 }}>
            {me?.role}
          </span>
        </p>
        <button type="button" className="btn ghost theme-toggle-side" onClick={toggle}>
          {dark ? '☀️ Mode Terang' : '🌙 Mode Gelap'}
        </button>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: '1.5rem', width: '100%', color: '#e2e8f0', borderColor: '#334155' }}
          onClick={() => void logout()}
        >
          Keluar
        </button>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
