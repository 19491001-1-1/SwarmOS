#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { runMcpBridgeFromCli } from './mcp/bridge.js';
import { callInternalApi, type ParsedCommand } from './internalAgentApi.js';

type CliEnv = {
  CREWDEN_AGENT_ID?: string;
  CREWDEN_SERVER_URL?: string;
  CREWDEN_AGENT_TOKEN_FILE?: string;
};

type CliIo = {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  fetch: typeof fetch;
};

export async function runAgentCli(argv: string[], env: CliEnv = process.env, io: CliIo = { stdout: process.stdout, stderr: process.stderr, fetch }): Promise<number> {
  if (argv[0] === 'mcp-bridge') {
    return runMcpBridgeFromCli(argv.slice(1), env, {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      fetch: io.fetch,
    });
  }

  const agentId = env.CREWDEN_AGENT_ID;
  const serverUrl = env.CREWDEN_SERVER_URL;
  const tokenFile = env.CREWDEN_AGENT_TOKEN_FILE;
  if (!agentId || !serverUrl || !tokenFile) {
    io.stderr.write('missing CREWDEN_AGENT_ID, CREWDEN_SERVER_URL, or CREWDEN_AGENT_TOKEN_FILE\n');
    return 2;
  }

  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) {
    io.stderr.write('agent token file is empty\n');
    return 2;
  }

  try {
    const command = parseCommand(argv);
    const result = await callInternalApi({ command, agentId, serverUrl, token, fetchImpl: io.fetch });
    io.stdout.write(formatOutput(selectResult(command, result)) + '\n');
    return 0;
  } catch (err) {
    io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function parseCommand(argv: string[]): ParsedCommand {
  const [group, action, ...rest] = argv;
  if (group === 'auth' && action === 'whoami') return { method: 'GET', path: '/auth/whoami' };
  if (group === 'server' && action === 'info') return { method: 'GET', path: '/server/info' };
  if (group === 'agent' && (action === 'list' || action === 'directory')) return { method: 'GET', path: '/server/info', select: 'agents' };
  if (group === 'agent' && action === 'resolve') {
    const query = required(rest[0], 'query');
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    const params = new URLSearchParams({ query });
    return { method: 'GET', path: `/agents/resolve?${params.toString()}` };
  }
  if (group === 'agent' && action === 'update') {
    const targetAgentId = required(rest[0], 'agent id');
    const opts = parseFlags(rest.slice(1));
    const body: Record<string, string> = {};
    if (typeof opts.runtime === 'string') body.runtime = opts.runtime;
    if (typeof opts.model === 'string') body.model = opts.model;
    if (typeof opts['display-name'] === 'string') body.displayName = opts['display-name'];
    if (typeof opts.description === 'string') body.description = opts.description;
    if (typeof opts.machine === 'string') body.machineId = opts.machine;
    if (Object.keys(body).length === 0) throw new Error('missing update field');
    return { method: 'PATCH', path: `/agents/${encodeURIComponent(targetAgentId)}`, body };
  }
  if (group === 'message' && action === 'check') return { method: 'GET', path: '/messages/check' };
  if (group === 'inbox' && action === undefined) return { method: 'GET', path: '/inbox' };
  if (group === 'work' && action === 'list') return { method: 'GET', path: '/work' };
  if (group === 'message' && action === 'read') {
    const opts = parseFlags(rest);
    const params = new URLSearchParams({
      channel: stringFlag(opts.channel, 'general'),
      limit: stringFlag(opts.limit, '20'),
    });
    return { method: 'GET', path: `/messages/read?${params.toString()}` };
  }
  if (group === 'message' && action === 'send') {
    const opts = parseFlags(rest);
    return {
      method: 'POST',
      path: '/messages/send',
      body: {
        channel: opts.channel ?? 'general',
        content: required(opts.content, '--content'),
        threadRootId: opts['thread-root-id'] ?? opts.thread,
      },
    };
  }
  if (group === 'dm' && action === 'send') {
    const opts = parseFlags(rest);
    return { method: 'POST', path: '/dms/send', body: { to: required(opts.to, '--to'), content: required(opts.content, '--content') } };
  }
  if (group === 'agent' && action === 'delegate') {
    const opts = parseFlags(rest);
    return {
      method: 'POST',
      path: '/delegate',
      body: { to: required(opts.to, '--to'), content: required(opts.content, '--content'), startIfInactive: Boolean(opts['start-if-inactive']) },
    };
  }
  if (group === 'task' && action === 'list') {
    const opts = parseFlags(rest);
    const params = new URLSearchParams();
    if (typeof opts.channel === 'string') params.set('channel', opts.channel);
    if (typeof opts.status === 'string') params.set('status', opts.status);
    if (opts.all === true) params.set('all', 'true');
    const query = params.toString();
    return { method: 'GET', path: `/tasks${query ? `?${query}` : ''}` };
  }
  if (group === 'task' && action === 'read') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return { method: 'GET', path: `/tasks/${encodeURIComponent(taskId)}`, select: opts.context === true ? undefined : 'task-summary' };
  }
  if (group === 'task' && action === 'update') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return {
      method: 'POST',
      path: `/tasks/${encodeURIComponent(taskId)}/update`,
      body: {
        status: typeof opts.status === 'string' ? opts.status : undefined,
        assigneeId: typeof opts.assignee === 'string' ? opts.assignee : undefined,
      },
    };
  }
  if (group === 'task' && action === 'handoff') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return {
      method: 'POST',
      path: `/tasks/${encodeURIComponent(taskId)}/handoff`,
      body: {
        to: required(opts.to, '--to'),
        notes: required(opts.notes, '--notes'),
        goal: typeof opts.goal === 'string' ? opts.goal : undefined,
        nextStep: typeof opts['next-step'] === 'string' ? opts['next-step'] : undefined,
      },
    };
  }
  if (group === 'task' && action === 'claim') {
    const taskId = required(rest[0], 'task id');
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    return { method: 'POST', path: `/tasks/${encodeURIComponent(taskId)}/claim`, body: {} };
  }
  if (group === 'task' && action === 'progress') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return { method: 'POST', path: `/tasks/${encodeURIComponent(taskId)}/progress`, body: { detail: required(opts.detail, '--detail') } };
  }
  if (group === 'task' && action === 'block') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return {
      method: 'POST',
      path: `/tasks/${encodeURIComponent(taskId)}/block`,
      body: { reason: required(opts.reason, '--reason'), needs: required(opts.needs, '--needs') },
    };
  }
  if (group === 'task' && action === 'escalate') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return { method: 'POST', path: `/tasks/${encodeURIComponent(taskId)}/escalate`, body: { reason: required(opts.reason, '--reason') } };
  }
  if (group === 'review' && action === 'list') {
    const opts = parseFlags(rest);
    const params = new URLSearchParams();
    if (opts.all === true) params.set('all', 'true');
    const query = params.toString();
    return { method: 'GET', path: `/reviews${query ? `?${query}` : ''}` };
  }
  if (group === 'review' && action === 'request') {
    const taskId = required(rest[0], 'task id');
    const opts = parseFlags(rest.slice(1));
    return {
      method: 'POST',
      path: `/tasks/${encodeURIComponent(taskId)}/reviews`,
      body: {
        reviewerAgentId: required(opts.reviewer, '--reviewer'),
        evidence: splitList(opts.evidence),
        checklist: splitList(opts.check),
        comment: typeof opts.comment === 'string' ? opts.comment : undefined,
        allowSelfReview: opts['allow-self-review'] === true,
        selfReviewReason: typeof opts['self-review-reason'] === 'string' ? opts['self-review-reason'] : undefined,
      },
    };
  }
  if (group === 'review' && action === 'approve') {
    const reviewId = required(rest[0], 'review id');
    const opts = parseFlags(rest.slice(1));
    return { method: 'POST', path: `/reviews/${encodeURIComponent(reviewId)}/approve`, body: { comment: required(opts.comment, '--comment') } };
  }
  if (group === 'review' && action === 'request-changes') {
    const reviewId = required(rest[0], 'review id');
    const opts = parseFlags(rest.slice(1));
    return { method: 'POST', path: `/reviews/${encodeURIComponent(reviewId)}/request-changes`, body: { comment: required(opts.comment, '--comment') } };
  }
  if (group === 'goal' && action === 'list') {
    const opts = parseFlags(rest);
    const params = new URLSearchParams();
    if (typeof opts.channel === 'string') params.set('channel', opts.channel);
    if (typeof opts.status === 'string') params.set('status', opts.status);
    const query = params.toString();
    return { method: 'GET', path: `/goals${query ? `?${query}` : ''}` };
  }
  if (group === 'goal' && action === 'read') {
    const goalId = required(rest[0], 'goal id');
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    return { method: 'GET', path: `/goals/${encodeURIComponent(goalId)}` };
  }
  if (group === 'goal' && action === 'archive') {
    const goalId = required(rest[0], 'goal id');
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    return { method: 'POST', path: `/goals/${encodeURIComponent(goalId)}/archive`, body: {} };
  }
  if (group === 'goal' && action === 'create') {
    const opts = parseFlags(rest);
    return {
      method: 'POST',
      path: '/goals',
      body: {
        channel: opts.channel ?? 'general',
        objective: required(opts.objective, '--objective'),
        background: splitList(opts.background),
        successCriteria: splitList(opts.success ?? opts['success-criteria']),
        constraints: splitList(opts.constraint ?? opts.constraints),
        assumptions: splitList(opts.assumption ?? opts.assumptions),
        risks: splitList(opts.risk ?? opts.risks),
      },
    };
  }
  if (group === 'goal' && action === 'create-tasks') {
    const goalId = required(rest[0], 'goal id');
    const opts = parseFlags(rest.slice(1));
    return {
      method: 'POST',
      path: `/goals/${encodeURIComponent(goalId)}/tasks`,
      body: {
        creatorName: typeof opts.creator === 'string' ? opts.creator : 'user',
        tasks: parseJsonArray(required(opts['tasks-json'], '--tasks-json')),
      },
    };
  }
  if (group === 'goal' && action === 'align') {
    const messageId = required(rest[0], 'message id');
    const opts = parseFlags(rest.slice(1));
    const params = new URLSearchParams({ messageId });
    return {
      method: 'POST',
      path: `/goals/align?${params.toString()}`,
      body: {
        requesterName: typeof opts.requester === 'string' ? opts.requester : 'user',
        objective: typeof opts.objective === 'string' ? opts.objective : undefined,
      },
    };
  }
  if (group === 'goal' && action === 'alignment') {
    const subaction = required(rest[0], 'alignment action');
    const alignmentId = required(rest[1], 'alignment id');
    if (subaction === 'read') {
      if (rest.length > 2) throw new Error(`unexpected argument: ${rest[2]}`);
      return { method: 'GET', path: `/goal-alignments/${encodeURIComponent(alignmentId)}` };
    }
    if (subaction === 'confirm') {
      if (rest.length > 2) throw new Error(`unexpected argument: ${rest[2]}`);
      return { method: 'POST', path: `/goal-alignments/${encodeURIComponent(alignmentId)}/confirm`, body: {} };
    }
    throw new Error(`unknown goal alignment action: ${subaction}`);
  }
  if (group === 'knowledge' && action === 'search') {
    const query = required(rest[0], 'query');
    const opts = parseFlags(rest.slice(1));
    const params = new URLSearchParams({ query });
    if (typeof opts.kind === 'string') params.set('kind', opts.kind);
    for (const tag of splitList(opts.tag)) params.append('tag', tag);
    return { method: 'GET', path: `/knowledge?${params.toString()}` };
  }
  if (group === 'knowledge' && action === 'read') {
    const id = required(rest[0], 'knowledge id');
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    return { method: 'GET', path: `/knowledge/${encodeURIComponent(id)}` };
  }
  if (group === 'knowledge' && action === 'write') {
    const opts = parseFlags(rest);
    return {
      method: 'POST',
      path: '/knowledge',
      body: {
        kind: required(opts.kind, '--kind'),
        title: required(opts.title, '--title'),
        summary: required(opts.summary, '--summary'),
        body: required(opts.body, '--body'),
        tags: splitList(opts.tag),
        sourceRefs: splitList(opts.source ?? opts['source-ref']),
        allowNoSource: opts['allow-no-source'] === true,
        reviewerAgentId: typeof opts.reviewer === 'string' ? opts.reviewer : undefined,
      },
    };
  }
  throw new Error('unknown command');
}

function selectResult(command: ParsedCommand, result: unknown): unknown {
  if (command.method === 'GET' && command.select === 'agents') {
    return isRecord(result) && Array.isArray(result.agents) ? result.agents : [];
  }
  if (command.method === 'GET' && command.select === 'task-summary' && isRecord(result)) {
    const { context: _context, ...summary } = result;
    return summary;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

function required(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`missing ${flag}`);
  return value;
}

function stringFlag(value: string | boolean | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function splitList(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value.split('|').map((item) => item.trim()).filter(Boolean);
}

function parseJsonArray(value: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('--tasks-json must be a JSON array');
  return parsed;
}

function formatOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAgentCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
