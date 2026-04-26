import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

describe('machine identity', () => {
  it('persists a stable machine id under the user home directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'crewden-machine-id-'));
    const originalHome = process.env.HOME;
    const originalMachineId = process.env.CREWDEN_MACHINE_ID;

    try {
      process.env.HOME = home;
      delete process.env.CREWDEN_MACHINE_ID;
      vi.resetModules();
      const mod = await import('../src/machineIdentity.js');

      const first = await mod.getMachineId();
      const second = await mod.getMachineId();

      expect(first).toMatch(/^machine-/);
      expect(second).toBe(first);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;

      if (originalMachineId === undefined) delete process.env.CREWDEN_MACHINE_ID;
      else process.env.CREWDEN_MACHINE_ID = originalMachineId;

      await rm(home, { recursive: true, force: true });
    }
  });
});
