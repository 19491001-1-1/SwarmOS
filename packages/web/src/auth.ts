const STORAGE_KEY = 'xoxiang.webAuthToken';
const SIGNED_OUT_KEY = 'xoxiang.webAuthSignedOut';

export const BUILT_IN_WEB_AUTH_TOKEN = (import.meta.env.VITE_WEB_AUTH_TOKEN ?? '').trim();

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
}

export function setStoredAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token.trim());
  window.localStorage.removeItem(SIGNED_OUT_KEY);
}

export function clearStoredAuthToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function markSignedOut(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.setItem(SIGNED_OUT_KEY, '1');
}

export function isSignedOut(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIGNED_OUT_KEY) === '1';
}

export function getEffectiveAuthToken(): string {
  if (isSignedOut()) return '';
  return getStoredAuthToken() || BUILT_IN_WEB_AUTH_TOKEN;
}
