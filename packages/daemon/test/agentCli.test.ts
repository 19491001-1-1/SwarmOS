import { mkdtemp, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { runAgentCli } from '../src/agentCli.js';

describe('agent-facing xoxiang CLI', () => {
  async function run(argv: string[], fetchImpl: typeof fetch = okFetch({ ok: true })) {
    const dir = await mkdtemp(join(tmpdir(), 'xoxiang-agent-cli-'));
    const tokenFile = join(dir, 'agent-token');
    await writeFile(tokenFile, 'token-1\n');
    let stdout = '';
    let stderr = '';
    const code = await runAgentCli(
      argv,
      {
        XOXIANG_AGENT_ID: 'agent-1',
        XOXIANG_SERVER_URL: 'http://hub.test',
        XOXIANG_AGENT_TOKEN_FILE: tokenFile,
      },
      {
        stdout: { write: (chunk: string | Uint8Array) => { stdout += String(chunk); return true; } },
        stderr: { write: (chunk: string | Uint8Array) => { stderr += String(chunk); return true; } },
        fetch: fetchImpl,
      }
    );
    return { code, stdout, stderr };
  }

  it('calls auth whoami', async () => {
    const fetchImpl = okFetch({ agent: { id: 'agent-1', name: 'bot' } });
    const result = await run(['auth', 'whoami'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/auth/whoami',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1', 'X-Agent-Id': 'agent-1' }),
      })
    );
  });

  it('sends channel messages', async () => {
    const fetchImpl = okFetch({ id: 'msg-1' });
    const result = await run(['message', 'send', '--channel', 'general', '--content', 'hello'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/messages/send',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ channel: 'general', content: 'hello' }) })
    );
  });

  it('sends DMs', async () => {
    const fetchImpl = okFetch({ id: 'dm-1' });
    const result = await run(['dm', 'send', '--to', 'target', '--content', 'secret'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/dms/send',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'target', content: 'secret' }) })
    );
  });

  it('lists the agent directory from server info', async () => {
    const fetchImpl = okFetch({
      agents: [
        { id: 'agent-1', name: 'self', runtime: 'codex', status: 'idle' },
        { id: 'agent-2', name: 'designer', displayName: 'Designer', description: 'UI specialist', runtime: 'claude', status: 'idle' },
      ],
    });
    const result = await run(['agent', 'list'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/server/info',
      expect.objectContaining({ method: 'GET' })
    );
    expect(JSON.parse(result.stdout)).toEqual([
      { id: 'agent-1', name: 'self', runtime: 'codex', status: 'idle' },
      { id: 'agent-2', name: 'designer', displayName: 'Designer', description: 'UI specialist', runtime: 'claude', status: 'idle' },
    ]);
  });

  it('supports agent directory as an alias for agent list', async () => {
    const fetchImpl = okFetch({ agents: [] });
    const result = await run(['agent', 'directory'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/server/info',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('resolves an agent reference', async () => {
    const fetchImpl = okFetch({
      query: '产品经理',
      match: { id: 'agent-111', name: 'pm-111', displayName: '产品经理' },
      confidence: 'exact_display_name',
      candidates: [{ id: 'agent-111', name: 'pm-111', displayName: '产品经理' }],
    });
    const result = await run(['agent', 'resolve', '产品经理'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/agents/resolve?query=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86',
      expect.objectContaining({ method: 'GET' })
    );
    expect(JSON.parse(result.stdout).match.id).toBe('agent-111');
  });

  it('delegates with wake flag', async () => {
    const fetchImpl = okFetch({ id: 'delegation-1' });
    const result = await run(['agent', 'delegate', '--to', 'target', '--content', 'work', '--start-if-inactive'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/delegate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'target', content: 'work', startIfInactive: true }) })
    );
  });

  it('lists assigned tasks with optional filters', async () => {
    const fetchImpl = okFetch([{ id: 'task-1', title: 'work' }]);
    const result = await run(['task', 'list', '--status', 'in_progress', '--channel', 'general'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/tasks?channel=general&status=in_progress',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('reads a task', async () => {
    const fetchImpl = okFetch({ id: 'task-1', title: 'work', context: { goal: 'hidden detail' } });
    const result = await run(['task', 'read', 'task-1'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/tasks/task-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(JSON.parse(result.stdout).context).toBeUndefined();
  });

  it('reads a task with full context when requested', async () => {
    const fetchImpl = okFetch({ id: 'task-1', title: 'work', context: { goal: 'ship it' } });
    const result = await run(['task', 'read', 'task-1', '--context'], fetchImpl);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).context.goal).toBe('ship it');
  });

  it('updates task status', async () => {
    const fetchImpl = okFetch({ id: 'task-1', status: 'done' });
    const result = await run(['task', 'update', 'task-1', '--status', 'done'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/tasks/task-1/update',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'done' }) })
    );
  });

  it('hands off a task with notes', async () => {
    const fetchImpl = okFetch({ id: 'task-1', assigneeId: 'agent-2' });
    const result = await run(['task', 'handoff', 'task-1', '--to', 'agent-2', '--notes', 'done with analysis', '--next-step', 'write tests'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/tasks/task-1/handoff',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'agent-2', notes: 'done with analysis', nextStep: 'write tests' }),
      })
    );
  });
});

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}
