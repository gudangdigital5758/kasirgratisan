import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAdminAuth } from '../lib/auth';
import { GOOGLE_CLIENT_ID } from '../lib/config';

export default function LoginPage() {
  const { session, me, loading, loginWithGoogleIdToken, error, supabaseReady, googleReady } =
    useAdminAuth();

  useEffect(() => {
    document.title = 'Login · Profitku Admin';
  }, []);

  if (!loading && session && me) return <Navigate to="/" replace />;

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Profitku Admin</h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Ops console — members, langganan, events. Bukan app kasir.
          </p>
        </div>

        {!supabaseReady && (
          <p className="err">Set VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di admin/.env</p>
        )}
        {!googleReady && (
          <p className="err">Set VITE_GOOGLE_CLIENT_ID di admin/.env</p>
        )}

        {error && <p className="err">{error}</p>}

        {supabaseReady && googleReady && GOOGLE_CLIENT_ID && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={async (res) => {
                if (!res.credential) return;
                try {
                  await loginWithGoogleIdToken(res.credential);
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Login gagal');
                }
              }}
              onError={() => alert('Google login gagal')}
              useOneTap={false}
            />
          </div>
        )}

        <p className="muted" style={{ fontSize: '0.75rem' }}>
          Hanya email di allowlist Worker <code>ADMIN_EMAILS</code> atau tabel{' '}
          <code>admin_users</code>.
        </p>
      </div>
    </div>
  );
}
