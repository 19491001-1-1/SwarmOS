import { readFile } from 'fs/promises';
import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';
import { callInternalApi, type ParsedCommand } from '../internalAgentApi.js';

type BridgeEnv = {
  XOXIANG_AGENT_ID?: string;
  XOXIANG_SERVER_URL?: string;
  XOXIANG_AGENT_TOKEN_FILE?: string;
};

type BridgeIo = {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  fetch: typeof fetch;
};

type ToolName =
  | 'send_message'
  | 'check_messages'
  | 'read_history'
  | 'send_dm'
  | 'delegate_agent'
  | 'list_agents'
  | 'server_info'
  | 'list_tasks'
  | 'update_task_status';

const TOOL_NAMES: ToolName[] = [
  'send_message',
  'check_messages',
  'read_history',
  'send_dm',
  'delegate_agent',
  'list_agents',
  'server_info',
  'list_tasks',
  'update_task_status',
];

export async function runMcpBridgeFromCli(argv: string[], env: BridgeEnv = process.env, io: BridgeIo): Promise<number> {
  const opts = parseFlags(argv);
  const agentId = stringArg(opts['agent-id']) ?? env.XOXIANG_AGENT_ID;
  const serverUrl = stringArg(opts['server-url']) ?? env.XOXIANG_SERVER_URL;
  const tokenFile = stringArg(opts['auth-token-file']) ?? env.XOXIANG_AGENT_TOKEN_FILE;
  if (!agentId || !serverUrl || !tokenFile) {
    io.stderr.write('missing XOXIANG_AGENT_ID, XOXIANG_SERVER_URL, or XOXIANG_AGENT_TOKEN_FILE\n');
    return 2;
  }

  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) {
    io.stderr.write('agent token file is empty\n');
    return 2;
  }

  await runMcpBridge({ agentId, serverUrl, token, fetchImpl: io.fetch, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });
  return 0;
}

export async function runMcpBridge(input: {
  agentId: string;
  serverUrl: string;
  token: string;
  fetchImpl: typeof fetch;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}): Promise<void> {
  const rl = createInterface({ input: input.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const response = await handleJsonRpcLine(trimmed, input);
    if (response !== undefined) input.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function handleJsonRpcLine(line: string, ctx: { agentId: string; serverUrl: string; token: string; fetchImpl: typeof fetch }) {
  let request: any;
  try {
    request = JSON.parse(line);
  } catch (err) {
    return jsonRpcError(null, -32700, `parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!request || typeof request !== 'object' || typeof request.method !== 'string') {
    return jsonRpcError(request?.id ?? null, -32600, 'invalid request');
  }
  if (request.id === undefined && request.method.startsWith('notifications/')) return undefined;

  try {
    if (request.method === 'initialize') {
      return jsonRpcResult(request.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'xoxiang-agent-tools', version: '0.4.6' },
      });
    }
    if (request.method === 'tools/list') {
      return jsonRpcResult(request.id, { tools: TOOL_NAMES.map(toolDefinition) });
    }
    if (request.method === 'tools/call') {
      const params = asRecord(request.params, 'params');
      const name = requiredString(params.name, 'name') as ToolName;
      const args = params.arguments === undefined ? {} : asRecord(params.arguments, 'arguments');
      const result = await callMcpTool({ name, args, ...ctx });
      return jsonRpcResult(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    }
    return jsonRpcError(request.id ?? null, -32601, `unknown method: ${request.method}`);
  } catch (err) {
    return jsonRpcResult(request.id ?? null, {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    });
  }
}

export async function callMcpTool(input: {
  name: string;
  args: Record<string, unknown>;
  agentId: string;
  serverUrl: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<unknown> {
  if (!TOOL_NAMES.includes(input.name as ToolName)) throw new Error(`unknown tool: ${input.name}`);
  const command = toolToCommand(input.name as ToolName, input.args);
  return callInternalApi({ command, agentId: input.agentId, serverUrl: input.serverUrl, token: input.token, fetchImpl: input.fetchImpl });
}

function toolToCommand(name: ToolName, args: Record<string, unknown>): ParsedCommand {
  switch (name) {
    case 'send_message':
      return { method: 'POST', path: '/messages/send', body: { channel: optionalString(args.channelId, 'general'), content: requiredString(args.content, 'content') } };
    case 'check_messages':
      return { method: 'GET', path: '/messages/check' };
    case 'read_history': {
      const params = new URLSearchParams({
        channel: optionalString(args.channelId, 'general'),
        limit: String(optionalNumber(args.limit, 20)),
      });
      return { method: 'GET', path: `/messages/read?${params.toString()}` };
    }
    case 'send_dm':
      return { method: 'POST', path: '/dms/send', body: { to: requiredString(args.to, 'to'), content: requiredString(args.content, 'content') } };
    case 'delegate_agent':
      return {
        method: 'POST',
        path: '/delegate',
        body: {
          to: requiredString(args.to, 'to'),
          content: requiredString(args.content, 'content'),
          startIfInactive: optionalBoolean(args.startIfInactive, false),
        },
      };
    case 'list_agents':
      return { method: 'GET', path: '/server/info', select: 'agents' };
    case 'server_info':
      return { method: 'GET', path: '/server/info' };
    case 'list_tasks': {
      const params = new URLSearchParams();
      if (typeof args.channelId === 'string') params.set('channel', args.channelId);
      if (typeof args.status === 'string') params.set('status', args.status);
      if (args.all === true) params.set('all', 'true');
      const query = params.toString();
      return { method: 'GET', path: `/tasks${query ? `?${query}` : ''}` };
    }
    case 'update_task_status':
      return { method: 'POST', path: `/tasks/${encodeURIComponent(requiredString(args.taskId, 'taskId'))}/update`, body: { status: requiredString(args.status, 'status') } };
  }
}

function toolDefinition(name: ToolName) {
  return {
    name,
    description: `xoxiang collaboration tool: ${name}`,
    inputSchema: {
      type: 'object',
      properties: toolProperties(name),
      additionalProperties: false,
    },
  };
}

function toolProperties(name: ToolName): Record<string, unknown> {
  const str = { type: 'string' };
  const bool = { type: 'boolean' };
  const num = { type: 'number' };
  switch (name) {
    case 'send_message':
      return { channelId: str, content: str };
    case 'read_history':
      return { channelId: str, limit: num };
    case 'send_dm':
      return { to: str, content: str };
    case 'delegate_agent':
      return { to: str, content: str, startIfInactive: bool };
    case 'list_tasks':
      return { channelId: str, status: str, all: bool };
    case 'update_task_status':
      return { taskId: str, status: str };
    default:
      return {};
  }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
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

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${name}`);
  return value;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
