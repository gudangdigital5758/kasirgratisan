import { NavLink, Outlet } from 'react-router-dom';
import { useAdminAuth } from '../lib/auth';

const links = [
  { to: '/', end: true, label: 'Overview' },
  { to: '/members', label: 'Members' },
  { to: '/payments', label: 'Payments' },
  { to: '/events', label: 'Events / Live log' },
  { to: '/settings', label: 'Platform' },
];

export default function Shell() {
  const { me, logout } = useAdminAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Profitku Admin</h1>
        <p className="sub">
          {me?.email}
          <br />
          <span className="badge" style={{ marginTop: 6 }}>
            {me?.role}
          </span>
        </p>
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
