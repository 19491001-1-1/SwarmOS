import { describe, expect, it } from 'vitest';
import type { Machine } from '@crewden/shared';
import { findDuplicateMachineIds, findExistingMachineId } from '../src/machine.js';

const machines: Machine[] = [
  {
    id: 'machine-1',
    hostname: 'host',
    os: 'linux',
    daemonVersion: '0.1.0',
    runtimes: ['claude'],
    runtimeVersions: { claude: '1.0' },
    status: 'offline',
    connectedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'machine-2',
    hostname: 'host',
    os: 'linux',
    daemonVersion: '0.1.0',
    runtimes: ['codex'],
    runtimeVersions: { codex: '1.0' },
    status: 'offline',
    connectedAt: '2026-01-01T00:00:01.000Z',
  },
  {
    id: 'machine-3',
    hostname: 'host',
    os: 'darwin',
    daemonVersion: '0.1.0',
    runtimes: ['claude'],
    runtimeVersions: { claude: '1.0' },
    status: 'offline',
    connectedAt: '2026-01-01T00:00:02.000Z',
  },
];

describe('findExistingMachineId', () => {
  it('finds the first machine matching hostname and os', () => {
    expect(findExistingMachineId({ machines, hostname: 'host', os: 'linux' })).toBe('machine-1');
  });

  it('returns undefined when no machine matches hostname and os', () => {
    expect(findExistingMachineId({ machines, hostname: 'other', os: 'linux' })).toBeUndefined();
  });
});

describe('findDuplicateMachineIds', () => {
  it('returns same hostname/os machines excluding target', () => {
    expect(findDuplicateMachineIds({ machines, targetMachineId: 'machine-1', hostname: 'host', os: 'linux' })).toEqual(['machine-2']);
  });
});
