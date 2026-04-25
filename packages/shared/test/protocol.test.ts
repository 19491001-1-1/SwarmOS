import { describe, it, expect } from 'vitest';
import { DaemonToServerSchema, ServerToDaemonSchema, RuntimeIdSchema } from '../src/validation.js';

describe('DaemonToServer protocol', () => {
  it('parses a valid ready message', () => {
    const msg = {
      type: 'ready',
      hostname: 'my-machine',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude', 'gemini'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('ready');
    }
  });

  it('parses agent:message', () => {
    const msg = {
      type: 'agent:message',
      agentId: 'agent-1',
      channelId: 'channel-1',
      content: 'Hello world',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses agent:status', () => {
    const msg = {
      type: 'agent:status',
      agentId: 'agent-1',
      status: 'running',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses agent:activity', () => {
    const msg = {
      type: 'agent:activity',
      agentId: 'agent-1',
      activityType: 'sending',
      detail: 'channel:general',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('agent:activity');
      expect(result.data.activityType).toBe('sending');
    }
  });

  it('rejects unknown agent activity types', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:activity',
      agentId: 'agent-1',
      activityType: 'planning',
    });
    expect(result.success).toBe(false);
  });
});

describe('ServerToDaemon protocol', () => {
  it('parses agent:start', () => {
    const msg = {
      type: 'agent:start',
      agentId: 'agent-1',
      config: {
        runtime: 'claude',
        name: 'my-agent',
      },
      launchId: 'launch-1',
    };
    const result = ServerToDaemonSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses agent:deliver', () => {
    const msg = {
      type: 'agent:deliver',
      agentId: 'agent-1',
      seq: 1,
      message: {
        id: 'msg-1',
        channelId: 'ch-1',
        channelName: 'general',
        senderName: 'user',
        content: 'Hello',
        createdAt: new Date().toISOString(),
      },
    };
    const result = ServerToDaemonSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses ping', () => {
    const result = ServerToDaemonSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(true);
  });
});

describe('RuntimeId validation', () => {
  it('accepts valid runtimes', () => {
    expect(RuntimeIdSchema.safeParse('claude').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('codex').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('gemini').success).toBe(true);
  });

  it('rejects invalid runtime', () => {
    expect(RuntimeIdSchema.safeParse('gpt4').success).toBe(false);
    expect(RuntimeIdSchema.safeParse('').success).toBe(false);
  });
});
