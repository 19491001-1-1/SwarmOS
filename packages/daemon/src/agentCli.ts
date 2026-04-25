#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

type CliEnv = {
  XOXIANG_AGENT_ID?: string;
  XOXIANG_SERVER_URL?: string;
  XOXIANG_AGENT_TOKEN_FILE?: string;
};

type CliIo = {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  fetch: typeof fetch;
};

export async function runAgentCli(argv: string[], env: CliEnv = process.env, io: CliIo = { stdout: process.stdout, stderr: process.stderr, fetch }): Promise<number> {
  const agentId = env.XOXIANG_AGENT_ID;
  const serverUrl = env.XOXIANG_SERVER_URL;
  const tokenFile = env.XOXIANG_AGENT_TOKEN_FILE;
  if (!agentId || !serverUrl || !tokenFile) {
    io.stderr.write('missing XOXIANG_AGENT_ID, XOXIANG_SERVER_URL, or XOXIANG_AGENT_TOKEN_FILE\n');
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

type ParsedCommand =
  | { method: 'GET'; path: string; select?: 'agents' }
  | { method: 'POST'; path: string; body: unknown };

function parseCommand(argv: string[]): ParsedCommand {
  const [group, action, ...rest] = argv;
  if (group === 'auth' && action === 'whoami') return { method: 'GET', path: '/auth/whoami' };
  if (group === 'server' && action === 'info') return { method: 'GET', path: '/server/info' };
  if (group === 'agent' && (action === 'list' || action === 'directory')) return { method: 'GET', path: '/server/info', select: 'agents' };
  if (group === 'message' && action === 'check') return { method: 'GET', path: '/messages/check' };
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
    return { method: 'POST', path: '/messages/send', body: { channel: opts.channel ?? 'general', content: required(opts.content, '--content') } };
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
    if (rest.length > 1) throw new Error(`unexpected argument: ${rest[1]}`);
    return { method: 'GET', path: `/tasks/${encodeURIComponent(taskId)}` };
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
  throw new Error('unknown command');
}

function selectResult(command: ParsedCommand, result: unknown): unknown {
  if (command.method === 'GET' && command.select === 'agents') {
    return isRecord(result) && Array.isArray(result.agents) ? result.agents : [];
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

async function callInternalApi(input: { command: ParsedCommand; agentId: string; serverUrl: string; token: string; fetchImpl: typeof fetch }): Promise<unknown> {
  const url = `${input.serverUrl.replace(/\/$/, '')}/internal/agent/${encodeURIComponent(input.agentId)}${input.command.path}`;
  const res = await input.fetchImpl(url, {
    method: input.command.method,
    headers: {
      Authorization: `Bearer ${input.token}`,
      'X-Agent-Id': input.agentId,
      ...(input.command.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: input.command.method === 'POST' ? JSON.stringify(input.command.body) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`request failed ${res.status}: ${text}`);
  return body;
}

function formatOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAgentCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
