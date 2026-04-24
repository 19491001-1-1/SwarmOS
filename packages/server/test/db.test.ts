import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/db.js';

let store: InMemoryStore;

beforeEach(() => {
  store = new InMemoryStore();
});

describe('channels', () => {
  it('creates default general channel', () => {
    const channels = store.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('general');
  });

  it('can create additional channels', () => {
    store.createChannel('random', 'random');
    expect(store.listChannels()).toHaveLength(2);
  });
});

describe('messages', () => {
  it('inserts and lists messages', () => {
    store.createMessage({ id: 'msg-1', channelId: 'general', senderName: 'user', content: 'Hello' });
    store.createMessage({ id: 'msg-2', channelId: 'general', senderName: 'user', content: 'World' });
    const msgs = store.listMessages('general');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('Hello');
  });

  it('filters by channelId', () => {
    store.createChannel('other', 'other');
    store.createMessage({ id: 'msg-1', channelId: 'general', senderName: 'user', content: 'A' });
    store.createMessage({ id: 'msg-2', channelId: 'other', senderName: 'user', content: 'B' });
    expect(store.listMessages('general')).toHaveLength(1);
    expect(store.listMessages('other')).toHaveLength(1);
  });
});

describe('agents', () => {
  it('creates and lists agents', () => {
    store.createAgent({
      id: 'agent-1',
      name: 'my-agent',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    expect(store.listAgents()).toHaveLength(1);
    expect(store.getAgent('agent-1')?.name).toBe('my-agent');
  });

  it('updates agent status', () => {
    store.createAgent({
      id: 'agent-1',
      name: 'my-agent',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    store.updateAgentStatus('agent-1', 'running');
    expect(store.getAgent('agent-1')?.status).toBe('running');
  });
});

describe('machines', () => {
  it('upserts machine from daemon ready', () => {
    const machine = {
      id: 'machine-1',
      hostname: 'my-host',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude' as const],
      runtimeVersions: { claude: '1.0' },
      status: 'online' as const,
      connectedAt: new Date().toISOString(),
    };
    store.upsertMachine(machine);
    expect(store.getMachine('machine-1')?.hostname).toBe('my-host');
    expect(store.listMachines()).toHaveLength(1);
  });

  it('sets machine offline', () => {
    store.upsertMachine({
      id: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    store.setMachineOffline('machine-1');
    expect(store.getMachine('machine-1')?.status).toBe('offline');
  });
});
