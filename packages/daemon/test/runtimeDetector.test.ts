import { describe, it, expect, vi } from 'vitest';

// Mock execa before importing the module under test
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { detectRuntimes } from '../src/runtimeDetector.js';

const mockExeca = vi.mocked(execa);

describe('detectRuntimes', () => {
  it('detects runtimes when binaries exist', async () => {
    mockExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'claude') return { exitCode: 0, stdout: 'claude 1.0.0', stderr: '' } as any;
      if (cmd === 'gemini') return { exitCode: 0, stdout: 'gemini 0.1.0', stderr: '' } as any;
      throw new Error('not found');
    });

    const runtimes = await detectRuntimes();
    const ids = runtimes.map((r) => r.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('gemini');
    expect(ids).not.toContain('codex');
  });

  it('returns empty array when no binaries exist', async () => {
    mockExeca.mockRejectedValue(new Error('not found'));
    const runtimes = await detectRuntimes();
    expect(runtimes).toHaveLength(0);
  });

  it('captures version strings', async () => {
    mockExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'claude') return { exitCode: 0, stdout: 'claude 2.0.0', stderr: '' } as any;
      throw new Error('not found');
    });

    const runtimes = await detectRuntimes();
    const claude = runtimes.find((r) => r.id === 'claude');
    expect(claude?.version).toBe('claude 2.0.0');
  });

  it('omits unavailable runtimes', async () => {
    mockExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'codex') return { exitCode: 0, stdout: 'codex 1.0', stderr: '' } as any;
      throw new Error('not found');
    });

    const runtimes = await detectRuntimes();
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0].id).toBe('codex');
  });
});
