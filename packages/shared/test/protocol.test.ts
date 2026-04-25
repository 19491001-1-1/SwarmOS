import { describe, it, expect } from 'vitest';
import {
  DaemonToServerSchema,
  ServerToDaemonSchema,
  RuntimeIdSchema,
  CreateAgentRequestSchema,
  PatchAgentRequestSchema,
  CreateChannelRequestSchema,
  CreateMessageRequestSchema,
  CreateDirectMessageRequestSchema,
  CreateAgentDelegationRequestSchema,
  CreateTaskRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalDmSendRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskUpdateRequestSchema,
  MessageToTaskRequestSchema,
  PatchTaskRequestSchema,
  TaskSchema,
} from '../src/validation.js';
import { APP_VERSION, createVersionInfo } from '../src/version.js';

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

  it('parses workspace:result', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'workspace:result',
      requestId: 'workspace-1',
      result: {
        type: 'dir',
        path: '',
        children: [{ name: 'transcript.txt', type: 'file', size: 12 }],
      },
    });
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

  it('parses agent:dm', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:dm',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      content: 'private hello',
    });
    expect(result.success).toBe(true);
  });

  it('parses agent:delegate', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:delegate',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      content: 'please handle this',
      startIfInactive: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent:delegate payloads', () => {
    expect(DaemonToServerSchema.safeParse({ type: 'agent:delegate', fromAgentId: 'a', toAgentId: '', content: 'x' }).success).toBe(false);
    expect(DaemonToServerSchema.safeParse({ type: 'agent:delegate', fromAgentId: 'a', toAgentId: 'b', content: '' }).success).toBe(false);
  });

  it('parses agent task events', () => {
    expect(DaemonToServerSchema.safeParse({
      type: 'agent:create_task',
      agentId: 'agent-1',
      title: 'write tests',
      channelId: 'general',
      assigneeId: 'agent-2',
    }).success).toBe(true);
    expect(DaemonToServerSchema.safeParse({
      type: 'agent:update_task',
      agentId: 'agent-1',
      taskId: 'task-1',
      status: 'in_review',
    }).success).toBe(true);
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
        agentToken: 'token-1',
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

  it('parses workspace:read', () => {
    const result = ServerToDaemonSchema.safeParse({
      type: 'workspace:read',
      agentId: 'agent-1',
      requestId: 'workspace-1',
      relPath: 'transcript.txt',
    });
    expect(result.success).toBe(true);
  });
});

describe('Internal agent API schemas', () => {
  it('accepts agent-facing CLI request bodies', () => {
    expect(InternalMessageSendRequestSchema.safeParse({ channel: 'general', content: 'hello' }).success).toBe(true);
    expect(InternalMessageReadRequestSchema.safeParse({ channel: 'general', limit: '10' }).success).toBe(true);
    expect(InternalDmSendRequestSchema.safeParse({ to: 'agent-2', content: 'secret' }).success).toBe(true);
    expect(InternalAgentResolveRequestSchema.safeParse({ query: '产品经理' }).success).toBe(true);
    expect(InternalAgentDelegateRequestSchema.safeParse({ to: 'agent-2', content: 'work', startIfInactive: true }).success).toBe(true);
    expect(InternalTaskListRequestSchema.safeParse({ status: 'todo', all: 'true' }).success).toBe(true);
    expect(InternalTaskUpdateRequestSchema.safeParse({ status: 'in_progress' }).success).toBe(true);
  });

  it('rejects empty internal agent API content', () => {
    expect(InternalMessageSendRequestSchema.safeParse({ channel: 'general', content: '' }).success).toBe(false);
    expect(InternalDmSendRequestSchema.safeParse({ to: 'agent-2', content: '' }).success).toBe(false);
    expect(InternalAgentResolveRequestSchema.safeParse({ query: '' }).success).toBe(false);
    expect(InternalAgentDelegateRequestSchema.safeParse({ to: '', content: 'work' }).success).toBe(false);
    expect(InternalTaskUpdateRequestSchema.safeParse({}).success).toBe(false);
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

describe('CreateAgentRequestSchema', () => {
  it('accepts minimal valid body', () => {
    const result = CreateAgentRequestSchema.safeParse({ name: 'a', runtime: 'claude' });
    expect(result.success).toBe(true);
  });

  it('accepts body with all optional fields', () => {
    const result = CreateAgentRequestSchema.safeParse({
      name: 'a',
      runtime: 'claude',
      displayName: 'A',
      description: 'desc',
      model: 'sonnet',
      systemPrompt: 'be helpful',
      machineId: 'm-1',
      envVars: { FOO: 'bar' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: '', runtime: 'claude' }).success).toBe(false);
  });

  it('rejects missing runtime', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: 'a' }).success).toBe(false);
  });

  it('rejects invalid runtime', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: 'a', runtime: 'gpt4' }).success).toBe(false);
  });
});

describe('CreateChannelRequestSchema', () => {
  it('accepts display-oriented channel names', () => {
    const result = CreateChannelRequestSchema.safeParse({ name: '  产品 讨论  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('产品 讨论');
  });

  it('rejects empty and control-character channel names', () => {
    expect(CreateChannelRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateChannelRequestSchema.safeParse({ name: 'ops\nteam' }).success).toBe(false);
  });
});

describe('PatchAgentRequestSchema', () => {
  it('accepts single field update', () => {
    expect(PatchAgentRequestSchema.safeParse({ displayName: 'New' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ machineId: 'm-2' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ description: 'desc' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ model: 'sonnet' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ systemPrompt: 'sp' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ autoStart: true }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ envVars: { A: 'B' } }).success).toBe(true);
  });

  it('rejects empty body', () => {
    expect(PatchAgentRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateDirectMessageRequestSchema', () => {
  it('accepts a direct message body', () => {
    expect(CreateDirectMessageRequestSchema.safeParse({ content: 'hello' }).success).toBe(true);
    expect(CreateDirectMessageRequestSchema.safeParse({ fromAgentId: 'user', content: 'hello' }).success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(CreateDirectMessageRequestSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('CreateAgentDelegationRequestSchema', () => {
  it('accepts a delegation body', () => {
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: 'do this' }).success).toBe(true);
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: 'do this', startIfInactive: false }).success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('Task schemas', () => {
  it('accepts task objects and request bodies', () => {
    expect(TaskSchema.safeParse({
      id: 'task-1',
      channelId: 'general',
      title: 'ship board',
      status: 'todo',
      creatorName: 'user',
      context: {
        goal: 'ship context',
        acceptanceCriteria: ['passes tests'],
        handoffNotes: ['from agent: continue here'],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).success).toBe(true);
    expect(CreateTaskRequestSchema.safeParse({ title: 'ship board', context: { goal: 'ship board' } }).success).toBe(true);
    expect(PatchTaskRequestSchema.safeParse({ status: 'done', context: { artifacts: ['docs/v0.6-task-board.md'] } }).success).toBe(true);
    expect(MessageToTaskRequestSchema.safeParse({ creatorName: 'user' }).success).toBe(true);
    expect(InternalTaskHandoffRequestSchema.safeParse({ to: 'agent-2', notes: 'done with analysis', nextStep: 'write tests' }).success).toBe(true);
  });

  it('rejects invalid task status and empty patches', () => {
    expect(PatchTaskRequestSchema.safeParse({ status: 'blocked' }).success).toBe(false);
    expect(PatchTaskRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateMessageRequestSchema', () => {
  it('accepts valid message', () => {
    const result = CreateMessageRequestSchema.safeParse({ senderName: 'u', content: 'hi' });
    expect(result.success).toBe(true);
  });

  it('accepts message with agentId', () => {
    const result = CreateMessageRequestSchema.safeParse({
      senderName: 'u',
      content: 'hi',
      agentId: 'a-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty senderName', () => {
    expect(
      CreateMessageRequestSchema.safeParse({ senderName: '', content: 'hi' }).success,
    ).toBe(false);
  });

  it('rejects empty content', () => {
    expect(
      CreateMessageRequestSchema.safeParse({ senderName: 'u', content: '' }).success,
    ).toBe(false);
  });
});

describe('version info', () => {
  it('uses the shared app version by default', () => {
    expect(createVersionInfo('daemon')).toEqual({ component: 'daemon', version: APP_VERSION });
  });

  it('keeps injected build metadata', () => {
    expect(createVersionInfo('web', { version: 'abc123', commit: 'abc123', build: '42' })).toEqual({
      component: 'web',
      version: 'abc123',
      commit: 'abc123',
      build: '42',
    });
  });
});
