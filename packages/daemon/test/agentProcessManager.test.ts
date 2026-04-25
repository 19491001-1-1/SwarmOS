import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentProcessManager } from '../src/agentProcessManager.js';
import { BRIDGE_MARKER } from '../src/bridge/simpleToolBridge.js';
import { EventEmitter } from 'events';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('transcript content'),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { spawn } from 'child_process';

const mockSpawn = vi.mocked(spawn);

function createFakeProc(stdout: string[], exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  // Emit output asynchronously
  setTimeout(() => {
    for (const line of stdout) {
      proc.stdout.emit('data', Buffer.from(line + '\n'));
    }
    proc.emit('close', exitCode);
  }, 10);

  return proc;
}

describe('AgentProcessManager', () => {
  let messages: Array<{ agentId: string; channelId: string; content: string }> = [];
  let statuses: Array<{ agentId: string; status: string }> = [];
  let activities: Array<{ agentId: string; type: string; detail?: string }> = [];
  let dms: Array<{ fromAgentId: string; toAgentId: string; content: string }> = [];
  let delegations: Array<{ fromAgentId: string; toAgentId: string; content: string; startIfInactive?: boolean }> = [];
  let manager: AgentProcessManager;

  beforeEach(() => {
    messages = [];
    statuses = [];
    activities = [];
    dms = [];
    delegations = [];
    manager = new AgentProcessManager(
      '/tmp/test-workspaces',
      (agentId, channelId, content) => messages.push({ agentId, channelId, content }),
      (agentId, status) => statuses.push({ agentId, status }),
      (agentId, type, detail) => activities.push({ agentId, type, detail }),
      (fromAgentId, toAgentId, content) => dms.push({ fromAgentId, toAgentId, content }),
      (fromAgentId, toAgentId, content, startIfInactive) => delegations.push({ fromAgentId, toAgentId, content, startIfInactive })
    );
  });

  it('startAgent creates workspace directory', async () => {
    const { mkdir } = await import('fs/promises');
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(false);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');

    expect(vi.mocked(mkdir)).toHaveBeenCalledWith(
      expect.stringContaining('agent-1'),
      { recursive: true }
    );
  });

  it('startAgent uses correct driver', async () => {
    await manager.startAgent('agent-1', { runtime: 'gemini', name: 'bot' }, 'general');
    expect(manager.isRunning('agent-1')).toBe(true);
  });

  it('deliverMessage writes to stdin and spawns process', async () => {
    const fakeProc = createFakeProc([]);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.deliverMessage('agent-1', {
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.any(Object)
    );
    expect(activities.some((a) => a.agentId === 'agent-1' && a.type === 'working' && a.detail === 'Message received')).toBe(true);
    expect(activities.some((a) => a.agentId === 'agent-1' && a.type === 'thinking')).toBe(true);
  });

  it('stdout line parsed into agent:message', async () => {
    const fakeProc = createFakeProc([`${BRIDGE_MARKER} {"content":"Echo: Hello"}`]);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.deliverMessage('agent-1', {
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    // wait for async process
    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Echo: Hello');
    expect(messages[0].agentId).toBe('agent-1');
    expect(activities.some((a) => a.type === 'sending' && a.detail === 'channel:general')).toBe(true);
    expect(activities.some((a) => a.type === 'idle')).toBe(true);
  });

  it('fallback stdout is reported as output activity', async () => {
    const fakeProc = createFakeProc(['Plain fallback answer']);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.deliverMessage('agent-1', {
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(messages[0].content).toBe('Plain fallback answer');
    expect(activities.some((a) => a.type === 'output' && a.detail === 'Plain fallback answer')).toBe(true);
  });

  it('stdout DM marker is reported as agent dm', async () => {
    const fakeProc = createFakeProc(['[[MINI_SLOCK_SEND_DM]] {"to":"agent-2","content":"secret"}']);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.deliverMessage('agent-1', {
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(dms).toEqual([{ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'secret' }]);
    expect(activities.some((a) => a.type === 'sending' && a.detail === 'dm:agent-2')).toBe(true);
  });

  it('stdout delegation marker is reported as agent delegation', async () => {
    const fakeProc = createFakeProc(['[[MINI_SLOCK_DELEGATE_AGENT]] {"to":"agent-2","content":"please work","startIfInactive":true}']);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.deliverMessage('agent-1', {
      id: 'msg-1',
      channelId: 'general',
      channelName: 'general',
      senderName: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(delegations).toEqual([{ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'please work', startIfInactive: true }]);
    expect(activities.some((a) => a.type === 'sending' && a.detail === 'delegating to agent-2')).toBe(true);
  });

  it('stopAgent kills process', async () => {
    const fakeProc = createFakeProc([]);
    mockSpawn.mockReturnValue(fakeProc);

    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    manager.stopAgent('agent-1');

    expect(manager.isRunning('agent-1')).toBe(false);
    const statusEvents = statuses.filter((s) => s.agentId === 'agent-1');
    expect(statusEvents.some((s) => s.status === 'inactive')).toBe(true);
  });
});
