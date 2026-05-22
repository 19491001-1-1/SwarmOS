import { beforeEach, describe, expect, it } from 'vitest';
import { lockManager } from '../src/locks.js';

beforeEach(() => {
  lockManager.reset();
});

describe('lockManager', () => {
  it('rejects concurrent acquire on the same path', () => {
    const first = lockManager.acquire('/tmp/test-file', 'agent-1');
    expect(first).toEqual({ granted: true });

    const second = lockManager.acquire('/tmp/test-file', 'agent-2');
    expect(second).toEqual({ granted: false, currentOwner: 'agent-1' });
  });

  it('allows acquire after release', () => {
    lockManager.acquire('/tmp/test-file', 'agent-1');
    lockManager.release('/tmp/test-file', 'agent-1');

    const reacquire = lockManager.acquire('/tmp/test-file', 'agent-2');
    expect(reacquire).toEqual({ granted: true });
  });

  it('rejects release by non-owner', () => {
    lockManager.acquire('/tmp/test-file', 'agent-1');
    const result = lockManager.release('/tmp/test-file', 'agent-2');
    expect(result).toBe(false);
  });

  it('returns status locked for active locks', () => {
    lockManager.acquire('/tmp/test-file', 'agent-1');
    expect(lockManager.status('/tmp/test-file')).toMatchObject({
      state: 'locked',
      owner: 'agent-1',
    });
  });

  it('returns status released after release', () => {
    lockManager.acquire('/tmp/test-file', 'agent-1');
    lockManager.release('/tmp/test-file', 'agent-1');

    const status = lockManager.status('/tmp/test-file');
    expect(status.state).toBe('released');
    expect(status).toHaveProperty('owner', 'agent-1');
    expect(status).toHaveProperty('since');
  });

  it('returns status unlocked for never-locked paths', () => {
    expect(lockManager.status('/tmp/never-locked')).toEqual({ state: 'unlocked' });
  });

  it('returns status unlocked after released entry expires', async () => {
    lockManager.acquire('/tmp/test-file', 'agent-1');
    lockManager.release('/tmp/test-file', 'agent-1');
    await new Promise((r) => setTimeout(r, 5));
    lockManager.cleanExpiredReleased(0);
    expect(lockManager.status('/tmp/test-file')).toEqual({ state: 'unlocked' });
  });

  it('calls onChange callback on acquire', () => {
    const calls: Array<{ path: string; state: string; owner: string }> = [];
    const cb = (path: string, state: string, owner: string) => calls.push({ path, state, owner });
    lockManager.onChange(cb);

    lockManager.acquire('/tmp/callback-test', 'agent-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/tmp/callback-test', state: 'locked', owner: 'agent-1' });

    // Cleanup
    lockManager.offChange(cb);
    lockManager.release('/tmp/callback-test', 'agent-1');
    lockManager.cleanExpiredReleased(0);
  });

  it('calls onChange callback on release', () => {
    lockManager.acquire('/tmp/callback-test-2', 'agent-1');

    const calls: Array<{ path: string; state: string; owner: string }> = [];
    const cb = (path: string, state: string, owner: string) => calls.push({ path, state, owner });
    lockManager.onChange(cb);

    lockManager.release('/tmp/callback-test-2', 'agent-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/tmp/callback-test-2', state: 'released', owner: 'agent-1' });

    // Cleanup
    lockManager.offChange(cb);
    lockManager.cleanExpiredReleased(0);
  });

  it('isLocked returns true only for active locks', () => {
    lockManager.acquire('/tmp/test-locked', 'agent-1');
    expect(lockManager.isLocked('/tmp/test-locked')).toBe(true);
    expect(lockManager.isLocked('/tmp/other')).toBe(false);
    lockManager.release('/tmp/test-locked', 'agent-1');
    expect(lockManager.isLocked('/tmp/test-locked')).toBe(false);
  });

  it('isReleased returns true only for released entries', async () => {
    lockManager.acquire('/tmp/test-released', 'agent-1');
    expect(lockManager.isReleased('/tmp/test-released')).toBe(false);
    lockManager.release('/tmp/test-released', 'agent-1');
    expect(lockManager.isReleased('/tmp/test-released')).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    lockManager.cleanExpiredReleased(0);
    expect(lockManager.isReleased('/tmp/test-released')).toBe(false);
  });
});
