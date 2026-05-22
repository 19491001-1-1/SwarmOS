import { describe, expect, it, vi } from 'vitest';
import { runWithTimeout } from '../src/timeouts.js';

describe('runWithTimeout', () => {
  it('resolves normally when promise completes before timeout', async () => {
    const result = await runWithTimeout(Promise.resolve('done'), 1000);
    expect(result).toEqual({ ok: true, value: 'done' });
  });

  it('times out when promise takes too long', async () => {
    const result = await runWithTimeout(new Promise((resolve) => setTimeout(resolve, 5000)), 1);
    expect(result).toEqual({ ok: false, timedOut: true });
  });

  it('calls onTimeout callback when timeout fires', async () => {
    const onTimeout = vi.fn();
    await runWithTimeout(new Promise((resolve) => setTimeout(resolve, 5000)), 1, onTimeout);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not call onTimeout when promise completes in time', async () => {
    const onTimeout = vi.fn();
    await runWithTimeout(Promise.resolve('fast'), 1000, onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('handles immediate rejection before timeout', async () => {
    await expect(runWithTimeout(Promise.reject(new Error('fail')), 1000)).rejects.toThrow('fail');
  });
});
