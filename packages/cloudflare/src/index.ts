import { DurableObject } from 'cloudflare:workers';
import type {
  Agent,
  AgentActivity,
  BrowserEvent,
  Channel,
  DaemonToServer,
  Machine,
  Message,
  RuntimeId,
  ServerToDaemon,
} from '@mini-slock/shared';
import {
  createVersionInfo,
  CreateAgentRequestSchema,
  CreateMessageRequestSchema,
  PatchAgentRequestSchema,
} from '@mini-slock/shared';
import { findDuplicateMachineIds, resolveStartMachineId, toAgentDelivery, toRuntimeConfig } from '@mini-slock/hub-core';

type SocketAttachment =
  | { kind: 'browser' }
  | { kind: 'daemon'; machineId: string };

type Row = Record<string, string | null>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.HUB.idFromName('central');
    const hub = env.HUB.get(id);
    return hub.fetch(request);
  },
};

export class XoxiangHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/version') {
      return json(createVersionInfo('cloudflare-hub', {
        version: this.env.XOXIANG_VERSION,
        commit: this.env.XOXIANG_COMMIT_SHA,
        build: this.env.XOXIANG_BUILD_ID,
      }));
    }

    if (url.pathname === '/ws') {
      const authResp = await requireBrowserAuthForWs(url, this.env);
      if (authResp) return authResp;
      return this.acceptBrowser(request);
    }
    if (url.pathname === '/daemon/connect') return this.acceptDaemon(request, url);

    if (url.pathname.startsWith('/api/')) {
      const authResp = await requireBrowserAuth(request, this.env);
      if (authResp) return authResp;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/channels') {
        return json(this.listChannels());
      }

      const messagesMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === 'GET') {
        const channel = this.getChannel(messagesMatch[1]);
        if (!channel) return json({ error: 'Channel not found' }, 404);
        return json(this.listMessages(messagesMatch[1]));
      }

      if (messagesMatch && request.method === 'POST') {
        return this.createUserMessage(messagesMatch[1], await request.json());
      }

      if (request.method === 'GET' && url.pathname === '/api/agents') {
        return json(this.listAgents());
      }

      const activitiesMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/activities$/);
      if (activitiesMatch && request.method === 'GET') {
        if (!this.getAgent(activitiesMatch[1])) return json({ error: 'Agent not found' }, 404);
        return json(this.listAgentActivities(activitiesMatch[1], 200));
      }

      if (request.method === 'POST' && url.pathname === '/api/agents') {
        return this.createAgent(await request.json());
      }

      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && request.method === 'PATCH') {
        return this.patchAgent(agentMatch[1], await request.json());
      }

      const startMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
      if (startMatch && request.method === 'POST') {
        return this.startAgent(startMatch[1]);
      }

      const stopMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
      if (stopMatch && request.method === 'POST') {
        return this.stopAgent(stopMatch[1]);
      }

      if (request.method === 'GET' && url.pathname === '/api/machines') {
        return json(this.listMachines());
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(JSON.stringify({ msg: 'request failed', error: err instanceof Error ? err.message : String(err) }));
      return json({ error: 'Internal server error' }, 500);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let data: DaemonToServer;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    if (!attachment || attachment.kind !== 'daemon') return;

    if (data.type === 'pong' || data.type === 'agent:deliver:ack') return;

    if (data.type === 'ready') {
      const machineId = data.machineId || attachment.machineId;
      ws.serializeAttachment({ kind: 'daemon', machineId } satisfies SocketAttachment);
      const duplicateIds = findDuplicateMachineIds({
        machines: this.listMachines(),
        targetMachineId: machineId,
        hostname: data.hostname,
        os: data.os,
      });
      this.mergeMachines(machineId, duplicateIds);
      const machine = this.upsertMachine({
        id: machineId,
        hostname: data.hostname,
        os: data.os,
        daemonVersion: data.daemonVersion,
        runtimes: data.runtimes,
        runtimeVersions: data.runtimeVersions,
        status: 'online',
        connectedAt: new Date().toISOString(),
      });
      this.broadcast({ type: 'machine:update', machine });
      this.reconcileReadyAgents(machineId, data.runtimes, new Set(data.runningAgents));
      return;
    }

    if (data.type === 'agent:status') {
      const agent = this.updateAgent(data.agentId, { status: data.status });
      if (agent) this.broadcast({ type: 'agent:update', agent });
      return;
    }

    if (data.type === 'agent:message') {
      const channel = this.getChannel(data.channelId);
      if (!channel) return;
      const agent = this.getAgent(data.agentId);
      const created = this.createMessage({
        id: crypto.randomUUID(),
        channelId: data.channelId,
        agentId: data.agentId,
        senderName: agent?.displayName ?? agent?.name ?? data.agentId,
        content: data.content,
      });
      this.broadcast({ type: 'message:new', message: created });
      return;
    }

    if (data.type === 'agent:activity') {
      const activity = this.createAgentActivity({
        id: crypto.randomUUID(),
        agentId: data.agentId,
        type: data.activityType,
        detail: data.detail,
      });
      this.broadcast({ type: 'agent:activity', agentId: data.agentId, activity });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    if (!attachment || attachment.kind !== 'daemon') return;
    const machine = this.setMachineOffline(attachment.machineId);
    if (machine) this.broadcast({ type: 'machine:update', machine });
    this.markMachineAgentsInactive(attachment.machineId);
  }

  private acceptBrowser(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ kind: 'browser' } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptDaemon(request: Request, url: URL): Response {
    const key = url.searchParams.get('key');
    const expected = this.env.DAEMON_API_KEY;
    if (!key || !expected || !timingSafeEqualStr(key, expected)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ kind: 'daemon', machineId: crypto.randomUUID() } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private initSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        machine_id TEXT,
        status TEXT NOT NULL,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      const message = [String(err), (err as { message?: string }).message, (err as { cause?: { message?: string } }).cause?.message]
        .join(' ')
        .toLowerCase();
      if (!message.includes('duplicate column')) throw err;
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        daemon_version TEXT NOT NULL,
        runtimes TEXT NOT NULL,
        runtime_versions TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO channels (id, name, created_at) VALUES (?, ?, ?)',
      'general',
      'general',
      new Date().toISOString()
    );
  }

  private createUserMessage(channelId: string, body: unknown): Response {
    const channel = this.getChannel(channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const parsed = CreateMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const payload = parsed.data;

    const message = this.createMessage({
      id: crypto.randomUUID(),
      channelId,
      senderName: payload.senderName,
      content: payload.content,
      agentId: payload.agentId,
    });
    this.broadcast({ type: 'message:new', message });

    if (payload.agentId) {
      const agent = this.getAgent(payload.agentId);
      const machineId = agent ? this.resolveStartMachineId(agent) : undefined;
      if (agent && machineId && agent.status !== 'inactive') {
        this.sendToDaemon(machineId, {
          type: 'agent:deliver',
          agentId: agent.id,
          seq: Date.now(),
          message: toAgentDelivery(message, channel),
          channelId: channel.id,
          config: toRuntimeConfig(agent),
        });
      }
    }

    return json(message, 201);
  }

  private createAgent(body: unknown): Response {
    const parsed = CreateAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const payload = parsed.data;

    const agent: Agent = {
      id: crypto.randomUUID(),
      name: payload.name,
      displayName: payload.displayName,
      description: payload.description,
      runtime: payload.runtime,
      model: payload.model,
      systemPrompt: payload.systemPrompt,
      machineId: payload.machineId,
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO agents
       (id, name, display_name, description, runtime, model, system_prompt, machine_id, status, auto_start, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agent.id,
      agent.name,
      agent.displayName ?? null,
      agent.description ?? null,
      agent.runtime,
      agent.model ?? null,
      agent.systemPrompt ?? null,
      agent.machineId ?? null,
      agent.status,
      agent.autoStart ? 1 : 0,
      agent.createdAt
    );
    return json(agent, 201);
  }

  private patchAgent(agentId: string, body: unknown): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const parsed = PatchAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const updated = this.updateAgent(agentId, parsed.data);
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return json(updated);
  }

  private startAgent(agentId: string): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const machineId = this.resolveStartMachineId(agent);
    if (!machineId) return json({ error: 'No connected machine available for agent runtime' }, 503);

    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId,
      config: toRuntimeConfig(agent),
      launchId: crypto.randomUUID(),
    });
    if (!sent) return json({ error: 'Machine not connected' }, 503);

    const updated = this.updateAgent(agentId, { machineId, status: 'starting', autoStart: true });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return json(updated);
  }

  private stopAgent(agentId: string): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    if (agent.machineId) this.sendToDaemon(agent.machineId, { type: 'agent:stop', agentId });
    const updated = this.updateAgent(agentId, { status: 'inactive', autoStart: false });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return json(updated);
  }

  private listChannels(): Channel[] {
    return this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels ORDER BY created_at').toArray().map(toChannel);
  }

  private getChannel(id: string): Channel | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels WHERE id = ? LIMIT 1', id).one();
    return row ? toChannel(row) : undefined;
  }

  private listMessages(channelId: string): Message[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', channelId)
      .toArray()
      .map(toMessage);
  }

  private createMessage(message: Omit<Message, 'createdAt'>): Message {
    const created: Message = { ...message, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, channel_id, sender_name, content, agent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.senderName,
      created.content,
      created.agentId ?? null,
      created.createdAt
    );
    return created;
  }

  private createAgentActivity(activity: Omit<AgentActivity, 'createdAt'>): AgentActivity {
    const created: AgentActivity = { ...activity, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO activities (id, agent_id, type, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      created.id,
      created.agentId,
      created.type,
      created.detail ?? null,
      created.createdAt
    );
    this.truncateAgentActivities(created.agentId, 500);
    return created;
  }

  private listAgentActivities(agentId: string, limit: number): AgentActivity[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM activities WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?', agentId, limit)
      .toArray()
      .map(toAgentActivity);
  }

  private truncateAgentActivities(agentId: string, keep: number): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM activities
       WHERE agent_id = ?
         AND id NOT IN (
           SELECT id FROM activities
           WHERE agent_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
      agentId,
      agentId,
      keep
    );
  }

  private listAgents(): Agent[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM agents ORDER BY created_at').toArray().map(toAgent);
  }

  private getAgent(id: string): Agent | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM agents WHERE id = ? LIMIT 1', id).one();
    return row ? toAgent(row) : undefined;
  }

  private updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const existing = this.getAgent(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.ctx.storage.sql.exec(
      `UPDATE agents
       SET name = ?, display_name = ?, description = ?, runtime = ?, model = ?,
           system_prompt = ?, machine_id = ?, status = ?, auto_start = ?, created_at = ?
       WHERE id = ?`,
      updated.name,
      updated.displayName ?? null,
      updated.description ?? null,
      updated.runtime,
      updated.model ?? null,
      updated.systemPrompt ?? null,
      updated.machineId ?? null,
      updated.status,
      updated.autoStart ? 1 : 0,
      updated.createdAt,
      id
    );
    return updated;
  }

  private listMachines(): Machine[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM machines ORDER BY connected_at').toArray().map(toMachine);
  }

  private upsertMachine(machine: Machine): Machine {
    this.ctx.storage.sql.exec(
      `INSERT INTO machines (id, hostname, os, daemon_version, runtimes, runtime_versions, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         hostname = excluded.hostname,
         os = excluded.os,
         daemon_version = excluded.daemon_version,
         runtimes = excluded.runtimes,
         runtime_versions = excluded.runtime_versions,
         status = excluded.status,
         connected_at = excluded.connected_at`,
      machine.id,
      machine.hostname,
      machine.os,
      machine.daemonVersion,
      JSON.stringify(machine.runtimes),
      JSON.stringify(machine.runtimeVersions),
      machine.status,
      machine.connectedAt
    );
    return machine;
  }

  private setMachineOffline(machineId: string): Machine | undefined {
    this.ctx.storage.sql.exec("UPDATE machines SET status = 'offline' WHERE id = ?", machineId);
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM machines WHERE id = ? LIMIT 1', machineId).one();
    return row ? toMachine(row) : undefined;
  }

  private mergeMachines(targetMachineId: string, duplicateIds: string[]): void {
    for (const id of duplicateIds) {
      this.ctx.storage.sql.exec('UPDATE agents SET machine_id = ? WHERE machine_id = ?', targetMachineId, id);
      this.ctx.storage.sql.exec('DELETE FROM machines WHERE id = ?', id);
    }
  }

  private resolveStartMachineId(agent: Agent): string | undefined {
    return resolveStartMachineId({
      agent,
      machines: this.listMachines(),
      connectedMachineIds: this.connectedMachineIds(),
    });
  }

  private reconcileReadyAgents(machineId: string, runtimes: RuntimeId[], runningAgents: Set<string>): void {
    const supportedRuntimes = new Set<RuntimeId>(runtimes);
    for (const agent of this.listAgents()) {
      if (!agent.autoStart || !supportedRuntimes.has(agent.runtime)) continue;
      if (agent.machineId && agent.machineId !== machineId) continue;

      if (runningAgents.has(agent.id)) {
        const updated = this.updateAgent(agent.id, { machineId, status: 'running' });
        if (updated) this.broadcast({ type: 'agent:update', agent: updated });
        continue;
      }

      const sent = this.sendToDaemon(machineId, {
        type: 'agent:start',
        agentId: agent.id,
        config: toRuntimeConfig(agent),
        launchId: crypto.randomUUID(),
      });
      if (!sent) continue;
      const updated = this.updateAgent(agent.id, { machineId, status: 'starting' });
      if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    }
  }

  private markMachineAgentsInactive(machineId: string): void {
    const volatileStatuses = new Set(['starting', 'running', 'working', 'idle']);
    for (const agent of this.listAgents()) {
      if (agent.machineId !== machineId || !volatileStatuses.has(agent.status)) continue;
      const updated = this.updateAgent(agent.id, { status: 'inactive' });
      if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    }
  }

  private connectedMachineIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.kind === 'daemon') ids.add(attachment.machineId);
    }
    return ids;
  }

  private sendToDaemon(machineId: string, message: ServerToDaemon): boolean {
    const ws = this.ctx.getWebSockets().find((candidate) => {
      const attachment = candidate.deserializeAttachment() as SocketAttachment | undefined;
      return attachment?.kind === 'daemon' && attachment.machineId === machineId;
    });
    if (!ws) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  private broadcast(event: BrowserEvent): void {
    const raw = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.kind === 'browser') ws.send(raw);
    }
  }

}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function unauthorized(reason: string): Response {
  return json({ error: 'Unauthorized', reason }, 401);
}

export async function requireBrowserAuth(request: Request, env: Env): Promise<Response | null> {
  const expected = env.WEB_AUTH_TOKEN;
  if (!expected) return unauthorized('WEB_AUTH_TOKEN not configured');
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized('missing bearer token');
  const provided = match[1].trim();
  if (!provided) return unauthorized('missing bearer token');
  if (!timingSafeEqualStr(provided, expected)) return unauthorized('invalid token');
  return null;
}

export async function requireBrowserAuthForWs(url: URL, env: Env): Promise<Response | null> {
  const expected = env.WEB_AUTH_TOKEN;
  if (!expected) return new Response('Unauthorized', { status: 401 });
  const provided = url.searchParams.get('token') ?? '';
  if (!provided) return new Response('Unauthorized', { status: 401 });
  if (!timingSafeEqualStr(provided, expected)) return new Response('Unauthorized', { status: 401 });
  return null;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function toChannel(row: Row): Channel {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

function toMessage(row: Row): Message {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    senderName: String(row.sender_name),
    content: String(row.content),
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    createdAt: String(row.created_at),
  };
}

function toAgentActivity(row: Row): AgentActivity {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    type: String(row.type) as AgentActivity['type'],
    detail: row.detail ? String(row.detail) : undefined,
    createdAt: String(row.created_at),
  };
}

function toAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    displayName: row.display_name ? String(row.display_name) : undefined,
    description: row.description ? String(row.description) : undefined,
    runtime: String(row.runtime) as RuntimeId,
    model: row.model ? String(row.model) : undefined,
    systemPrompt: row.system_prompt ? String(row.system_prompt) : undefined,
    machineId: row.machine_id ? String(row.machine_id) : undefined,
    status: String(row.status) as Agent['status'],
    autoStart: Boolean(Number(row.auto_start ?? 0)),
    createdAt: String(row.created_at),
  };
}

function toMachine(row: Row): Machine {
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    os: String(row.os),
    daemonVersion: String(row.daemon_version),
    runtimes: JSON.parse(String(row.runtimes)) as RuntimeId[],
    runtimeVersions: JSON.parse(String(row.runtime_versions)) as Record<string, string>,
    status: String(row.status) as Machine['status'],
    connectedAt: String(row.connected_at),
  };
}
