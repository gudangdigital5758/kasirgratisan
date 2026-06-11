/**
 * Native Google Sign-In untuk Android (Capacitor) via @capgo/capacitor-social-login.
 *
 * Web tetap memakai Google Identity Services (@react-oauth/google). Di WebView
 * Android, GIS diblokir Google, jadi native pakai Credential Manager lewat plugin
 * ini. Keduanya menghasilkan Google ID token yang kompatibel dengan backend
 * (audience = Web Client ID).
 *
 * Plugin di-import dinamis agar bundle web tidak menyertakannya kecuali dipakai.
 */

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const { SocialLogin } = await import('@capgo/capacitor-social-login');
      await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID ?? '' } });
    })();
  }
  return initPromise;
}

/** Login Google native; mengembalikan Google ID token (JWT). */
export async function nativeGoogleSignIn(): Promise<string> {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  await ensureInit();
  const res = (await SocialLogin.login({ provider: 'google', options: {} })) as {
    result?: { idToken?: string | null };
  };
  const idToken = res?.result?.idToken;
  if (!idToken) throw new Error('Login Google gagal: idToken kosong');
  return idToken;
}

/** Logout dari sesi Google native (best-effort). */
export async function nativeGoogleSignOut(): Promise<void> {
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    /* abaikan */
  }
}
