import { Readable, Writable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { callMcpTool, runMcpBridge } from '../src/mcp/bridge.js';

describe('agent MCP bridge', () => {
  it('lists tools over stdio JSON-RPC', async () => {
    const stdout = new MemoryWritable();
    await runMcpBridge({
      agentId: 'agent-1',
      serverUrl: 'http://hub.test',
      token: 'token-1',
      fetchImpl: okFetch({}),
      stdin: Readable.from([
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
      ]),
      stdout,
      stderr: new MemoryWritable(),
    });

    const responses = stdout.lines().map((line) => JSON.parse(line));
    expect(responses[0].result.serverInfo.name).toBe('xoxiang-agent-tools');
    expect(responses[1].result.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining([
      'send_message',
      'check_messages',
      'read_history',
      'send_dm',
      'delegate_agent',
      'list_agents',
      'server_info',
      'schedule_reminder',
      'list_reminders',
      'cancel_reminder',
    ]));
  });

  it.each([
    ['send_message', { channelId: 'general', content: 'hello' }, 'http://hub.test/internal/agent/agent-1/messages/send', 'POST', { channel: 'general', content: 'hello' }],
    ['check_messages', {}, 'http://hub.test/internal/agent/agent-1/messages/check', 'GET', undefined],
    ['read_history', { channelId: 'general', limit: 5 }, 'http://hub.test/internal/agent/agent-1/messages/read?channel=general&limit=5', 'GET', undefined],
    ['send_dm', { to: 'agent-2', content: 'secret' }, 'http://hub.test/internal/agent/agent-1/dms/send', 'POST', { to: 'agent-2', content: 'secret' }],
    ['delegate_agent', { to: 'agent-2', content: 'work', startIfInactive: true }, 'http://hub.test/internal/agent/agent-1/delegate', 'POST', { to: 'agent-2', content: 'work', startIfInactive: true }],
    ['list_agents', {}, 'http://hub.test/internal/agent/agent-1/server/info', 'GET', undefined],
    ['server_info', {}, 'http://hub.test/internal/agent/agent-1/server/info', 'GET', undefined],
    ['list_tasks', { all: true, status: 'todo' }, 'http://hub.test/internal/agent/agent-1/tasks?status=todo&all=true', 'GET', undefined],
    ['update_task_status', { taskId: 'task-1', status: 'done' }, 'http://hub.test/internal/agent/agent-1/tasks/task-1/update', 'POST', { status: 'done' }],
    ['schedule_reminder', { channelId: 'general', message: 'hello', triggerAt: '2026-04-25T12:00:00.000Z' }, 'http://hub.test/internal/agent/agent-1/reminders', 'POST', { channelId: 'general', message: 'hello', triggerAt: '2026-04-25T12:00:00.000Z' }],
    ['list_reminders', {}, 'http://hub.test/internal/agent/agent-1/reminders', 'GET', undefined],
    ['cancel_reminder', { reminderId: 'rem-1' }, 'http://hub.test/internal/agent/agent-1/reminders/rem-1/cancel', 'POST', {}],
  ])('routes %s to the internal agent API', async (name, args, url, method, body) => {
    const fetchImpl = okFetch({ ok: true });

    await callMcpTool({ name, args, agentId: 'agent-1', serverUrl: 'http://hub.test', token: 'token-1', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method,
        headers: expect.objectContaining({ Authorization: 'Bearer token-1', 'X-Agent-Id': 'agent-1' }),
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  });

  it('returns tool errors over JSON-RPC instead of crashing', async () => {
    const stdout = new MemoryWritable();
    await runMcpBridge({
      agentId: 'agent-1',
      serverUrl: 'http://hub.test',
      token: 'token-1',
      fetchImpl: okFetch({}),
      stdin: Readable.from([
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_message', arguments: { channelId: 'general' } } }) + '\n',
      ]),
      stdout,
      stderr: new MemoryWritable(),
    });

    const response = JSON.parse(stdout.lines()[0]);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain('missing content');
  });

  it('surfaces unauthorized internal API responses as tool errors', async () => {
    await expect(callMcpTool({
      name: 'server_info',
      args: {},
      agentId: 'agent-1',
      serverUrl: 'http://hub.test',
      token: 'bad-token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid agent token' }), { status: 401 })) as unknown as typeof fetch,
    })).rejects.toThrow('request failed 401');
  });
});

class MemoryWritable extends Writable {
  private chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  lines(): string[] {
    return this.chunks.join('').split('\n').filter(Boolean);
  }
}

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}
