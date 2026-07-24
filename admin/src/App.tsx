import { Navigate, Route, Routes } from 'react-router-dom';
import { useAdminAuth } from './lib/auth';
import LoginPage from './pages/LoginPage';
import Shell from './pages/Shell';
import OverviewPage from './pages/OverviewPage';
import MembersPage from './pages/MembersPage';
import MemberDetailPage from './pages/MemberDetailPage';
import PaymentsPage from './pages/PaymentsPage';
import EventsPage from './pages/EventsPage';
import SettingsPage from './pages/SettingsPage';

function Guard({ children }: { children: React.ReactNode }) {
  const { session, me, loading, error } = useAdminAuth();
  if (loading) return <div className="login-wrap muted">Memuat sesi…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!me) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <h2>Akses ditolak</h2>
          <p className="err">{error || 'Akun ini bukan staff admin.'}</p>
          <p className="muted">
            Pastikan email Anda ada di <code>ADMIN_EMAILS</code> Worker secret, atau baris{' '}
            <code>admin_users</code> di Supabase.
          </p>
          <a className="btn ghost" href="/login">
            Kembali login
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <Shell />
          </Guard>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="members/:id" element={<MemberDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
