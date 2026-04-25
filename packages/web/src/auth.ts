const STORAGE_KEY = 'xoxiang.webAuthToken';

export const BUILT_IN_WEB_AUTH_TOKEN = (import.meta.env.VITE_WEB_AUTH_TOKEN ?? '').trim();

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
}

export function setStoredAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token.trim());
}

export function clearStoredAuthToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getEffectiveAuthToken(): string {
  return getStoredAuthToken() || BUILT_IN_WEB_AUTH_TOKEN;
}
