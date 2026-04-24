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
  let manager: AgentProcessManager;

  beforeEach(() => {
    messages = [];
    statuses = [];
    manager = new AgentProcessManager(
      '/tmp/test-workspaces',
      (agentId, channelId, content) => messages.push({ agentId, channelId, content }),
      (agentId, status) => statuses.push({ agentId, status })
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
