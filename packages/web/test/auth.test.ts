import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('web auth token storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_WEB_AUTH_TOKEN', 'test-web-token');
  });

  it('keeps explicit sign out across refresh even when a build-time token exists', () => {
    return import('../src/auth.js').then(({ getEffectiveAuthToken, isSignedOut, markSignedOut }) => {
    expect(getEffectiveAuthToken()).toBe('test-web-token');

    markSignedOut();

    expect(isSignedOut()).toBe(true);
    expect(getEffectiveAuthToken()).toBe('');
    });
  });

  it('clears the sign-out marker after manual login', () => {
    return import('../src/auth.js').then(({ getEffectiveAuthToken, isSignedOut, markSignedOut, setStoredAuthToken }) => {
    markSignedOut();

    setStoredAuthToken('manual-token');

    expect(isSignedOut()).toBe(false);
    expect(getEffectiveAuthToken()).toBe('manual-token');
    });
  });
});
