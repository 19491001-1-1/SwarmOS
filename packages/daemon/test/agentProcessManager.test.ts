import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentProcessManager } from '../src/agentProcessManager.js';
import { BRIDGE_MARKER } from '../src/bridge/simpleToolBridge.js';
import { EventEmitter } from 'events';
import { appendFile, writeFile } from 'fs/promises';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('transcript content'),
  readdir: vi.fn(),
  stat: vi.fn(),
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
    vi.clearAllMocks();
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

  it('startAgent injects agent-facing CLI wrapper and token file', async () => {
    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot', agentToken: 'agent-token-1' }, 'general');

    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/test-workspaces/agent-1/.xoxiang/agent-token'),
      'agent-token-1\n',
      { mode: 0o600 }
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/test-workspaces/agent-1/.xoxiang/xoxiang'),
      expect.stringContaining('agentCli.ts'),
      { mode: 0o755 }
    );
  });

  it('startAgent uses correct driver', async () => {
    await manager.startAgent('agent-1', { runtime: 'gemini', name: 'bot' }, 'general');
    expect(manager.isRunning('agent-1')).toBe(true);
    expect(manager.listRunningAgentIds()).toEqual(['agent-1']);
  });

  it('startAgent is idempotent for an already registered agent', async () => {
    await manager.startAgent('agent-1', { runtime: 'claude', name: 'bot' }, 'general');
    await manager.startAgent('agent-1', { runtime: 'gemini', name: 'bot' }, 'other');

    expect(manager.listRunningAgentIds()).toEqual(['agent-1']);
    expect(statuses.filter((s) => s.agentId === 'agent-1' && s.status === 'idle')).toHaveLength(2);
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
      expect.objectContaining({
        env: expect.objectContaining({
          XOXIANG_AGENT_ID: 'agent-1',
          XOXIANG_SERVER_URL: 'http://localhost:3000',
          XOXIANG_AGENT_TOKEN_FILE: expect.stringContaining('agent-token'),
        }),
      })
    );
    const spawnOptions = mockSpawn.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOptions.env?.XOXIANG_AGENT_TOKEN).toBeUndefined();
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
    expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
      expect.stringContaining('transcript.txt'),
      expect.stringContaining('user: Hello')
    );
    expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
      expect.stringContaining('transcript.txt'),
      expect.stringContaining('bot: Echo: Hello')
    );
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
    expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
      expect.stringContaining('transcript.txt'),
      expect.stringContaining('bot: Plain fallback answer')
    );
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
    expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
      expect.stringContaining('transcript.txt'),
      expect.stringContaining('bot -> dm:agent-2: secret')
    );
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
    expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
      expect.stringContaining('transcript.txt'),
      expect.stringContaining('bot -> delegate:agent-2: please work')
    );
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

  it('readWorkspace returns directory children sorted by type and name', async () => {
    const { readdir, stat } = await import('fs/promises');
    vi.mocked(readdir).mockResolvedValue([
      { name: 'z.txt', isDirectory: () => false },
      { name: 'src', isDirectory: () => true },
    ] as any);
    vi.mocked(stat).mockImplementation(async (path: any) => ({
      isDirectory: () => String(path).endsWith('agent-1') || String(path).endsWith('src'),
      isFile: () => String(path).endsWith('z.txt'),
      size: String(path).endsWith('z.txt') ? 4 : 0,
      mtime: new Date('2026-01-01T00:00:00.000Z'),
    } as any));

    const result = await manager.readWorkspace('agent-1', '');

    expect(result).toMatchObject({
      type: 'dir',
      path: '',
      children: [
        { name: 'src', type: 'dir' },
        { name: 'z.txt', type: 'file', size: 4 },
      ],
    });
  });

  it('readWorkspace truncates large files', async () => {
    const { readFile, stat } = await import('fs/promises');
    vi.mocked(stat).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 101 * 1024,
      mtime: new Date('2026-01-01T00:00:00.000Z'),
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.alloc(101 * 1024, 'a') as any);

    const result = await manager.readWorkspace('agent-1', 'big.txt');

    expect(result.type).toBe('file');
    if (result.type === 'file') {
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.content)).toBe(100 * 1024);
    }
  });

  it('readWorkspace rejects path traversal', async () => {
    await expect(manager.readWorkspace('agent-1', '../../../etc/passwd')).resolves.toMatchObject({
      type: 'error',
      status: 403,
    });
  });
});
