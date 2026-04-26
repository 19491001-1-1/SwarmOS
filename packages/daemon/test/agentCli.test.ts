import { mkdtemp, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { runAgentCli } from '../src/agentCli.js';

describe('agent-facing crewden CLI', () => {
  async function run(argv: string[], fetchImpl: typeof fetch = okFetch({ ok: true })) {
    const dir = await mkdtemp(join(tmpdir(), 'crewden-agent-cli-'));
    const tokenFile = join(dir, 'agent-token');
    await writeFile(tokenFile, 'token-1\n');
    let stdout = '';
    let stderr = '';
    const code = await runAgentCli(
      argv,
      {
        CREWDEN_AGENT_ID: 'agent-1',
        CREWDEN_SERVER_URL: 'http://hub.test',
        CREWDEN_AGENT_TOKEN_FILE: tokenFile,
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

  it('sends channel messages inside a thread', async () => {
    const fetchImpl = okFetch({ id: 'msg-1' });
    const result = await run(['message', 'send', '--channel', 'general', '--thread-root-id', 'root-1', '--content', 'hello'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/messages/send',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ channel: 'general', content: 'hello', threadRootId: 'root-1' }) })
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

  it('updates an agent runtime', async () => {
    const fetchImpl = okFetch({ id: 'agent-2', runtime: 'gemini' });
    const result = await run(['agent', 'update', 'agent-2', '--runtime', 'gemini'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/agents/agent-2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ runtime: 'gemini' }) })
    );
    expect(JSON.parse(result.stdout).runtime).toBe('gemini');
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

  it('supports inbox, work list, and autonomous task progress commands', async () => {
    const inboxFetch = okFetch([{ id: 'item-1' }]);
    const inbox = await run(['inbox'], inboxFetch);
    expect(inbox.code).toBe(0);
    expect(inboxFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/inbox', expect.objectContaining({ method: 'GET' }));

    const workFetch = okFetch({ inbox: [] });
    const work = await run(['work', 'list'], workFetch);
    expect(work.code).toBe(0);
    expect(workFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/work', expect.objectContaining({ method: 'GET' }));

    const claimFetch = okFetch({ id: 'task-1', assigneeId: 'agent-1' });
    expect((await run(['task', 'claim', 'task-1'], claimFetch)).code).toBe(0);
    expect(claimFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/tasks/task-1/claim', expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }));

    const progressFetch = okFetch({ id: 'task-1' });
    expect((await run(['task', 'progress', 'task-1', '--detail', 'heartbeat'], progressFetch)).code).toBe(0);
    expect(progressFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/tasks/task-1/progress', expect.objectContaining({ method: 'POST', body: JSON.stringify({ detail: 'heartbeat' }) }));

    const blockFetch = okFetch({ id: 'task-1' });
    expect((await run(['task', 'block', 'task-1', '--reason', 'missing input', '--needs', 'user decision'], blockFetch)).code).toBe(0);
    expect(blockFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/tasks/task-1/block', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'missing input', needs: 'user decision' }),
    }));

    const escalateFetch = okFetch({ id: 'task-1' });
    expect((await run(['task', 'escalate', 'task-1', '--reason', 'blocked'], escalateFetch)).code).toBe(0);
    expect(escalateFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/tasks/task-1/escalate', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'blocked' }) }));
  });

  it('supports review list, request, approve, and request-changes commands', async () => {
    const listFetch = okFetch([{ id: 'review-1' }]);
    expect((await run(['review', 'list'], listFetch)).code).toBe(0);
    expect(listFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/reviews', expect.objectContaining({ method: 'GET' }));

    const allFetch = okFetch([{ id: 'review-1' }]);
    expect((await run(['review', 'list', '--all'], allFetch)).code).toBe(0);
    expect(allFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/reviews?all=true', expect.objectContaining({ method: 'GET' }));

    const requestFetch = okFetch({ id: 'review-1' });
    expect((await run(['review', 'request', 'task-1', '--reviewer', 'qa', '--evidence', 'pnpm verify passed|web screenshot ok', '--check', 'tests pass|UI shows review'], requestFetch)).code).toBe(0);
    expect(requestFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/tasks/task-1/reviews', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        reviewerAgentId: 'qa',
        evidence: ['pnpm verify passed', 'web screenshot ok'],
        checklist: ['tests pass', 'UI shows review'],
        allowSelfReview: false,
      }),
    }));

    const approveFetch = okFetch({ id: 'review-1', status: 'approved' });
    expect((await run(['review', 'approve', 'review-1', '--comment', 'verified'], approveFetch)).code).toBe(0);
    expect(approveFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/reviews/review-1/approve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ comment: 'verified' }) }));

    const changesFetch = okFetch({ id: 'review-1', status: 'changes_requested' });
    expect((await run(['review', 'request-changes', 'review-1', '--comment', 'add evidence'], changesFetch)).code).toBe(0);
    expect(changesFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/reviews/review-1/request-changes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ comment: 'add evidence' }) }));
  });

  it('supports knowledge search, read, write, and goal archive commands', async () => {
    const searchFetch = okFetch([{ entry: { id: 'knowledge-1' } }]);
    expect((await run(['knowledge', 'search', 'test env', '--kind', 'decision', '--tag', 'v1|cloudflare'], searchFetch)).code).toBe(0);
    expect(searchFetch).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/knowledge?query=test+env&kind=decision&tag=v1&tag=cloudflare',
      expect.objectContaining({ method: 'GET' }),
    );

    const readFetch = okFetch({ id: 'knowledge-1' });
    expect((await run(['knowledge', 'read', 'knowledge-1'], readFetch)).code).toBe(0);
    expect(readFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/knowledge/knowledge-1', expect.objectContaining({ method: 'GET' }));

    const writeFetch = okFetch({ id: 'knowledge-1' });
    expect((await run([
      'knowledge',
      'write',
      '--kind',
      'decision',
      '--title',
      'V1 test environment',
      '--summary',
      'Use test Cloudflare',
      '--body',
      'Keep production isolated.',
      '--tag',
      'v1|cloudflare',
      '--source',
      'goal:v1',
    ], writeFetch)).code).toBe(0);
    expect(writeFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/knowledge', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        kind: 'decision',
        title: 'V1 test environment',
        summary: 'Use test Cloudflare',
        body: 'Keep production isolated.',
        tags: ['v1', 'cloudflare'],
        sourceRefs: ['goal:v1'],
        allowNoSource: false,
      }),
    }));

    const archiveFetch = okFetch({ id: 'archive-1' });
    expect((await run(['goal', 'archive', 'goal-1'], archiveFetch)).code).toBe(0);
    expect(archiveFetch).toHaveBeenCalledWith('http://hub.test/internal/agent/agent-1/goals/goal-1/archive', expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }));
  });

  it('lists goals with optional filters', async () => {
    const fetchImpl = okFetch([{ id: 'goal-1', objective: 'ship v1.1' }]);
    const result = await run(['goal', 'list', '--channel', 'general', '--status', 'draft'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goals?channel=general&status=draft',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('creates goals from CLI flags', async () => {
    const fetchImpl = okFetch({ id: 'goal-1' });
    const result = await run([
      'goal',
      'create',
      '--channel',
      'general',
      '--objective',
      'ship v1.1',
      '--success',
      'tasks have context|agents can read it',
      '--constraint',
      'stay in test env',
    ], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'general',
          objective: 'ship v1.1',
          background: [],
          successCriteria: ['tasks have context', 'agents can read it'],
          constraints: ['stay in test env'],
          assumptions: [],
          risks: [],
        }),
      })
    );
  });

  it('reads a goal with linked task summaries', async () => {
    const fetchImpl = okFetch({ goal: { id: 'goal-1' }, tasks: [] });
    const result = await run(['goal', 'read', 'goal-1'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goals/goal-1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('creates goal tasks from JSON', async () => {
    const fetchImpl = okFetch({ tasks: [{ id: 'task-1' }] });
    const result = await run(['goal', 'create-tasks', 'goal-1', '--tasks-json', '[{"title":"Draft MVP","acceptanceCriteria":["clear scope"]}]'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goals/goal-1/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          creatorName: 'user',
          tasks: [{ title: 'Draft MVP', acceptanceCriteria: ['clear scope'] }],
        }),
      })
    );
  });

  it('starts, reads, and confirms goal alignments', async () => {
    const fetchImpl = okFetch({ id: 'alignment-1' });
    const started = await run(['goal', 'align', 'msg-1', '--objective', 'ship v1.2'], fetchImpl);
    expect(started.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goals/align?messageId=msg-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requesterName: 'user', objective: 'ship v1.2' }),
      })
    );

    const readFetch = okFetch({ id: 'alignment-1', status: 'awaiting_confirmation' });
    const read = await run(['goal', 'alignment', 'read', 'alignment-1'], readFetch);
    expect(read.code).toBe(0);
    expect(readFetch).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goal-alignments/alignment-1',
      expect.objectContaining({ method: 'GET' })
    );

    const confirmFetch = okFetch({ goal: { id: 'goal-1' }, tasks: [] });
    const confirmed = await run(['goal', 'alignment', 'confirm', 'alignment-1'], confirmFetch);
    expect(confirmed.code).toBe(0);
    expect(confirmFetch).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/goal-alignments/alignment-1/confirm',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}
