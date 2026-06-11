import { jwtDecode } from 'jwt-decode';

/**
 * Penyimpanan & utilitas token Google ID (JWT) untuk Cloud API.
 * Token disimpan di localStorage; klaim di-decode untuk nama/email/expiry.
 */

const TOKEN_KEY = 'freekasir_cloud_token_v1';

export interface GoogleIdClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number; // detik epoch
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function decodeClaims(token: string): GoogleIdClaims | null {
  try {
    return jwtDecode<GoogleIdClaims>(token);
  } catch {
    return null;
  }
}

/** Token dianggap valid bila bisa di-decode dan belum kadaluarsa (margin 30 dtk). */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const claims = decodeClaims(token);
  if (!claims?.exp) return false;
  return claims.exp * 1000 - 30_000 > Date.now();
}
