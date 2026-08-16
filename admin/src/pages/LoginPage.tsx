import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAdminAuth } from '../lib/auth';
import { useAdminTheme } from '../lib/theme';
import { GOOGLE_CLIENT_ID } from '../lib/config';

export default function LoginPage() {
  const { session, me, loading, loginWithGoogleIdToken, error, supabaseReady, googleReady } =
    useAdminAuth();
  const { mode, cycle } = useAdminTheme();

  useEffect(() => {
    document.title = 'Login · Profitku Admin';
  }, []);

  if (!loading && session && me) return <Navigate to="/" replace />;

  const nextLabel =
    mode === 'dark' ? 'Mode terang' : mode === 'light' ? 'Mode sistem' : 'Mode gelap';

  return (
    <div className="login-wrap">
      <button
        type="button"
        className="theme-toggle login-theme-toggle"
        onClick={cycle}
        aria-label={nextLabel}
        title={nextLabel}
      >
        {mode === 'dark' ? '☀️' : mode === 'light' ? '🖥️' : '🌙'}
      </button>
      <div className="card login-card stack">
        {/* Brand header (wireframe login-form: logo + judul + subtitle) */}
        <div className="login-brand">
          <img
            src="/profitku-lockup.png"
            alt="Profitku"
            className="brand-logo"
          />
          <h1>Profitku Admin</h1>
          <p className="muted login-sub">Masuk untuk mengelola platform</p>
        </div>

        {!supabaseReady && (
          <p className="err">Set VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di admin/.env</p>
        )}
        {!googleReady && <p className="err">Set VITE_GOOGLE_CLIENT_ID di admin/.env</p>}

        {error && <p className="err">{error}</p>}

        {supabaseReady && googleReady && GOOGLE_CLIENT_ID && (
          <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <div className="login-google">
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
          </GoogleOAuthProvider>
        )}

        <p className="muted login-foot">Khusus staff admin Profitku</p>
      </div>
    </div>
  );
}
