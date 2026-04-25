import { DurableObject } from 'cloudflare:workers';
import type {
  Agent,
  AgentActivity,
  AgentDelegation,
  BrowserEvent,
  Channel,
  DaemonToServer,
  DirectMessage,
  DirectMessageThread,
  Machine,
  Message,
  Reminder,
  ReminderStatus,
  RuntimeId,
  ServerToDaemon,
  Task,
  TaskStatus,
  WorkspaceEntry,
  WorkspaceError,
} from '@mini-slock/shared';
import {
  createVersionInfo,
  CreateChannelRequestSchema,
  CreateAgentDelegationRequestSchema,
  CreateAgentRequestSchema,
  CreateDirectMessageRequestSchema,
  CreateReminderRequestSchema,
  CreateTaskRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalDmSendRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskUpdateRequestSchema,
  CreateMessageRequestSchema,
  MessageToTaskRequestSchema,
  PatchAgentRequestSchema,
  PatchReminderRequestSchema,
  PatchTaskRequestSchema,
  SearchRequestSchema,
  TaskStatusSchema,
} from '@mini-slock/shared';
import { findDuplicateMachineIds, resolveAgentReference, resolveStartMachineId, toAgentDelivery, toRuntimeConfig } from '@mini-slock/hub-core';

type SocketAttachment =
  | { kind: 'browser' }
  | { kind: 'daemon'; machineId: string };

type Row = Record<string, string | null>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.HUB.idFromName('central');
    const hub = env.HUB.get(id);
    return hub.fetch(request);
  },
};

export class XoxiangHub extends DurableObject<Env> {
  private workspaceReads = new Map<string, {
    resolve: (result: WorkspaceEntry | WorkspaceError) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    this.triggerDueReminders();

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

    if (url.pathname.startsWith('/internal/agent/')) {
      return this.handleInternalAgentRequest(request, url);
    }

    if (url.pathname.startsWith('/api/')) {
      const authResp = await requireBrowserAuth(request, this.env);
      if (authResp) return authResp;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/channels') {
        return json(this.listChannels());
      }

      if (request.method === 'POST' && url.pathname === '/api/channels') {
        return this.createUserChannel(await request.json());
      }

      const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
      if (channelMatch && request.method === 'DELETE') {
        return this.deleteUserChannel(decodeURIComponent(channelMatch[1]));
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        const parsed = SearchRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
        if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
        return json({ messages: this.searchMessages(parsed.data.q, parsed.data.limit) });
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

      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        const statusValue = url.searchParams.get('status') ?? undefined;
        const status = statusValue === undefined ? undefined : TaskStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid status' }, 400);
        return json(this.listTasks({
          channelId: url.searchParams.get('channelId') ?? undefined,
          status: status?.success ? status.data : undefined,
        }));
      }

      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        return this.createUserTask(await request.json());
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === 'PATCH') {
        return this.patchTask(decodeURIComponent(taskMatch[1]), await request.json());
      }

      if (taskMatch && request.method === 'DELETE') {
        return this.deleteTask(decodeURIComponent(taskMatch[1]));
      }

      const messageTaskMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/to-task$/);
      if (messageTaskMatch && request.method === 'POST') {
        return this.createTaskFromMessage(decodeURIComponent(messageTaskMatch[1]), await request.json().catch(() => ({})));
      }

      if (request.method === 'GET' && url.pathname === '/api/agents') {
        return json(this.listAgents());
      }

      const remindersMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/reminders$/);
      if (remindersMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(remindersMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listReminders(agentId));
      }

      if (remindersMatch && request.method === 'POST') {
        return this.createUserReminder(decodeURIComponent(remindersMatch[1]), await request.json());
      }

      const reminderMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
      if (reminderMatch && request.method === 'PATCH') {
        return this.patchReminder(decodeURIComponent(reminderMatch[1]), await request.json());
      }

      const dmThreadsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/dms$/);
      if (dmThreadsMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(dmThreadsMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listDirectMessageThreads(agentId));
      }

      const dmMessagesMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/dms\/([^/]+)$/);
      if (dmMessagesMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(dmMessagesMatch[1]);
        const otherId = decodeURIComponent(dmMessagesMatch[2]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listDirectMessages(agentId, otherId));
      }

      if (dmMessagesMatch && request.method === 'POST') {
        return this.createUserDirectMessage(
          decodeURIComponent(dmMessagesMatch[1]),
          decodeURIComponent(dmMessagesMatch[2]),
          await request.json(),
        );
      }

      const delegationListMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/delegations$/);
      if (delegationListMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(delegationListMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listAgentDelegations(agentId));
      }

      const delegationCreateMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/delegate\/([^/]+)$/);
      if (delegationCreateMatch && request.method === 'POST') {
        const fromAgentId = decodeURIComponent(delegationCreateMatch[1]);
        const toAgentId = decodeURIComponent(delegationCreateMatch[2]);
        return this.createUserDelegation(fromAgentId, toAgentId, await request.json());
      }

      const activitiesMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/activities$/);
      if (activitiesMatch && request.method === 'GET') {
        if (!this.getAgent(activitiesMatch[1])) return json({ error: 'Agent not found' }, 404);
        return json(this.listAgentActivities(activitiesMatch[1], 200));
      }

      const workspaceMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/workspace$/);
      if (workspaceMatch && request.method === 'GET') {
        return await this.readAgentWorkspace(decodeURIComponent(workspaceMatch[1]), url.searchParams.get('path') ?? '');
      }

      if (request.method === 'POST' && url.pathname === '/api/agents') {
        return this.createAgent(await request.json());
      }

      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && request.method === 'GET') {
        const agent = this.getAgent(decodeURIComponent(agentMatch[1]));
        if (!agent) return json({ error: 'Agent not found' }, 404);
        return json(agent);
      }

      if (agentMatch && request.method === 'PATCH') {
        return this.patchAgent(decodeURIComponent(agentMatch[1]), await request.json());
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

    if (data.type === 'pong' || data.type === 'agent:deliver:ack' || data.type === 'agent:session') return;

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
      return;
    }

    if (data.type === 'workspace:result') {
      this.resolveWorkspaceRead(data.requestId, data.result);
      return;
    }

    if (data.type === 'agent:dm') {
      const target = this.findAgentByNameOrId(data.toAgentId);
      if (!target) return;
      const dm = this.createDirectMessage({
        id: crypto.randomUUID(),
        fromAgentId: data.fromAgentId,
        toAgentId: target.id,
        content: data.content,
      });
      this.broadcast({ type: 'dm:new', dm });
      this.deliverDirectMessage(target, dm);
      return;
    }

    if (data.type === 'agent:delegate') {
      this.delegateAgent({
        fromAgentId: data.fromAgentId,
        toAgentId: data.toAgentId,
        content: data.content,
        startIfInactive: data.startIfInactive,
      });
      return;
    }

    if (data.type === 'agent:create_task') {
      const channelId = data.channelId ?? 'general';
      const channel = this.getChannel(channelId);
      if (!channel) return;
      const agent = this.getAgent(data.agentId);
      const assignee = data.assigneeId ? this.findAgentByNameOrId(data.assigneeId) : undefined;
      const task = this.createTask({
        id: crypto.randomUUID(),
        channelId,
        title: data.title,
        status: 'todo',
        creatorName: agent?.displayName ?? agent?.name ?? data.agentId,
        assigneeId: assignee?.id ?? data.assigneeId,
      });
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return;
    }

    if (data.type === 'agent:update_task') {
      const task = this.updateTask(data.taskId, { status: data.status });
      if (task) {
        this.broadcast({ type: 'task:update', task });
        this.notifyTaskAssignee(task);
      }
      return;
    }

    if (data.type === 'agent:set_reminder') {
      const channelId = data.channelId ?? 'general';
      const channel = this.getChannel(channelId);
      const agent = this.getAgent(data.agentId);
      if (!channel || !agent) return;
      const reminder = this.createReminder({
        id: crypto.randomUUID(),
        agentId: agent.id,
        channelId,
        message: data.message,
        triggerAt: data.triggerAt,
        status: 'pending',
      });
      this.broadcast({ type: 'reminder:update', reminder });
      return;
    }

    if (data.type === 'agent:cancel_reminder') {
      const reminder = this.getReminder(data.reminderId);
      if (!reminder || reminder.agentId !== data.agentId) return;
      const updated = this.updateReminder(data.reminderId, { status: 'cancelled' });
      if (updated) this.broadcast({ type: 'reminder:update', reminder: updated });
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
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        assignee_id TEXT,
        context TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE tasks ADD COLUMN context TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        trigger_at TEXT NOT NULL,
        status TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_delegations (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        agent_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
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
        env_vars TEXT,
        organization TEXT,
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
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN env_vars TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN organization TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
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
          config: this.toAgentRuntimeConfig(agent),
        });
      }
    }

    return json(message, 201);
  }

  private createUserChannel(body: unknown): Response {
    const parsed = CreateChannelRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (this.listChannels().some((channel) => channel.name === parsed.data.name)) return json({ error: 'Channel name already exists' }, 409);
    const channel = this.createChannel(crypto.randomUUID(), parsed.data.name);
    this.broadcast({ type: 'channel:created', channel });
    return json(channel, 201);
  }

  private deleteUserChannel(id: string): Response {
    if (id === 'general') return json({ error: 'Cannot delete general channel' }, 400);
    if (!this.getChannel(id)) return json({ error: 'Channel not found' }, 404);
    this.deleteChannel(id);
    this.broadcast({ type: 'channel:deleted', channelId: id });
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  private createUserTask(body: unknown): Response {
    const parsed = CreateTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (!this.getChannel(parsed.data.channelId)) return json({ error: 'Channel not found' }, 404);

    const task = this.createTask({
      id: crypto.randomUUID(),
      channelId: parsed.data.channelId,
      messageId: parsed.data.messageId,
      title: parsed.data.title,
      status: 'todo',
      creatorName: parsed.data.creatorName,
      assigneeId: parsed.data.assigneeId,
      context: parsed.data.context,
    });
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    return json(task, 201);
  }

  private createUserReminder(agentId: string, body: unknown): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateReminderRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const channel = this.findChannel(parsed.data.channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const reminder = this.createReminder({
      id: crypto.randomUUID(),
      agentId,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    this.broadcast({ type: 'reminder:update', reminder });
    return json(reminder, 201);
  }

  private patchReminder(id: string, body: unknown): Response {
    const parsed = PatchReminderRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const reminder = this.updateReminder(id, { status: parsed.data.status });
    if (!reminder) return json({ error: 'Reminder not found' }, 404);
    this.broadcast({ type: 'reminder:update', reminder });
    return json(reminder);
  }

  private patchTask(taskId: string, body: unknown): Response {
    const parsed = PatchTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const task = this.updateTask(taskId, parsed.data);
    if (!task) return json({ error: 'Task not found' }, 404);
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    return json(task);
  }

  private deleteTask(taskId: string): Response {
    if (!this.getTask(taskId)) return json({ error: 'Task not found' }, 404);
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE id = ?', taskId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  private createTaskFromMessage(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const parsed = MessageToTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);

    const task = this.createTask({
      id: crypto.randomUUID(),
      channelId: message.channelId,
      messageId: message.id,
      title: message.content.slice(0, 200),
      status: 'todo',
      creatorName: parsed.data.creatorName,
      assigneeId: parsed.data.assigneeId,
      context: {
        ...parsed.data.context,
        sourceMessageIds: Array.from(new Set([...(parsed.data.context?.sourceMessageIds ?? []), message.id])),
      },
    });
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    return json(task, 201);
  }

  private async handleInternalAgentRequest(request: Request, url: URL): Promise<Response> {
    const match = url.pathname.match(/^\/internal\/agent\/([^/]+)(\/.*)$/);
    if (!match) return json({ error: 'Not found' }, 404);
    const agentId = decodeURIComponent(match[1]);
    const path = match[2];
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);

    const authResp = this.requireAgentAuth(request, agentId);
    if (authResp) return authResp;

    if (request.method === 'GET' && path === '/auth/whoami') return json({ agent });

    if (request.method === 'GET' && path === '/server/info') {
      return json({
        agent,
        channels: this.listChannels(),
        agents: this.listAgents(),
        version: createVersionInfo('cloudflare-hub', {
          version: this.env.XOXIANG_VERSION,
          commit: this.env.XOXIANG_COMMIT_SHA,
          build: this.env.XOXIANG_BUILD_ID,
        }),
      });
    }

    if (request.method === 'GET' && path === '/agents/resolve') {
      const parsed = InternalAgentResolveRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      return json(resolveAgentReference(parsed.data.query, this.listAgents()));
    }

    if (request.method === 'GET' && path === '/messages/check') {
      return json({
        channels: this.listChannels().map((channel) => {
          const latest = this.listRecentMessages(channel.id, 1)[0];
          return { channelId: channel.id, channelName: channel.name, count: latest ? 1 : 0, latestMessage: latest };
        }),
        dms: this.listDirectMessageThreads(agent.id).map((thread) => ({
          otherAgentId: thread.otherAgentId,
          count: 1,
          latestMessage: thread.lastMessage,
        })),
      });
    }

    if (request.method === 'GET' && path === '/messages/read') {
      const parsed = InternalMessageReadRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const channel = this.findChannel(parsed.data.channel);
      if (!channel) return json({ error: 'Channel not found' }, 404);
      return json(this.listRecentMessages(channel.id, parsed.data.limit));
    }

    if (request.method === 'POST' && path === '/messages/send') {
      return this.createInternalMessage(agent, request);
    }

    if (request.method === 'POST' && path === '/dms/send') {
      return this.createInternalDirectMessage(agent, request);
    }

    if (request.method === 'POST' && path === '/delegate') {
      return this.createInternalDelegation(agent, request);
    }

    if (request.method === 'GET' && path === '/tasks') {
      const parsed = InternalTaskListRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const channel = parsed.data.channel ? this.findChannel(parsed.data.channel) : undefined;
      if (parsed.data.channel && !channel) return json({ error: 'Channel not found' }, 404);
      return json(this.listTasks({
        channelId: channel?.id,
        status: parsed.data.status,
        assigneeId: parsed.data.all ? undefined : agent.id,
      }));
    }

    if (request.method === 'GET' && path === '/reminders') {
      return json(this.listReminders(agent.id));
    }

    if (request.method === 'POST' && path === '/reminders') {
      const parsed = CreateReminderRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const channel = this.findChannel(parsed.data.channelId);
      if (!channel) return json({ error: 'Channel not found' }, 404);
      const reminder = this.createReminder({
        id: crypto.randomUUID(),
        agentId: agent.id,
        channelId: channel.id,
        message: parsed.data.message,
        triggerAt: parsed.data.triggerAt,
        status: 'pending',
      });
      this.broadcast({ type: 'reminder:update', reminder });
      return json(reminder, 201);
    }

    const reminderCancelMatch = path.match(/^\/reminders\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && reminderCancelMatch) {
      const existing = this.getReminder(decodeURIComponent(reminderCancelMatch[1]));
      if (!existing || existing.agentId !== agent.id) return json({ error: 'Reminder not found' }, 404);
      const reminder = this.updateReminder(existing.id, { status: 'cancelled' });
      if (reminder) this.broadcast({ type: 'reminder:update', reminder });
      return json(reminder);
    }

    const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
    if (request.method === 'GET' && taskMatch) {
      const task = this.getTask(decodeURIComponent(taskMatch[1]));
      if (!task) return json({ error: 'Task not found' }, 404);
      if (task.assigneeId && task.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      return json(task);
    }

    const taskUpdateMatch = path.match(/^\/tasks\/([^/]+)\/update$/);
    if (request.method === 'POST' && taskUpdateMatch) {
      const existing = this.getTask(decodeURIComponent(taskUpdateMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskUpdateRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const task = this.updateTask(existing.id, parsed.data);
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      return json(task);
    }

    const taskHandoffMatch = path.match(/^\/tasks\/([^/]+)\/handoff$/);
    if (request.method === 'POST' && taskHandoffMatch) {
      const existing = this.getTask(decodeURIComponent(taskHandoffMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskHandoffRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const target = this.findAgentByNameOrId(parsed.data.to);
      if (!target) return json({ error: 'Target agent not found' }, 404);
      const nextNote = [
        `from ${agent.displayName ?? agent.name}: ${parsed.data.notes}`,
        parsed.data.nextStep ? `next: ${parsed.data.nextStep}` : undefined,
      ].filter(Boolean).join('\n');
      const task = this.updateTask(existing.id, {
        assigneeId: target.id,
        context: {
          ...existing.context,
          goal: parsed.data.goal ?? existing.context?.goal,
          previousAgentId: agent.id,
          handoffNotes: [...(existing.context?.handoffNotes ?? []), nextNote],
        },
      });
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return json(task);
    }

    return json({ error: 'Not found' }, 404);
  }

  private async createInternalMessage(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalMessageSendRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const channel = this.findChannel(parsed.data.channel);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const message = this.createMessage({
      id: crypto.randomUUID(),
      channelId: channel.id,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: parsed.data.content,
    });
    this.broadcast({ type: 'message:new', message });
    return json(message, 201);
  }

  private async createInternalDirectMessage(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalDmSendRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const target = this.findAgentByNameOrId(parsed.data.to);
    if (!target) return json({ error: 'Target agent not found' }, 404);
    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: agent.id,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    this.broadcast({ type: 'dm:new', dm });
    this.deliverDirectMessage(target, dm);
    return json(dm, 201);
  }

  private async createInternalDelegation(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalAgentDelegateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const delegation = this.delegateAgent({
      fromAgentId: agent.id,
      toAgentId: parsed.data.to,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return json(delegation, delegation.status === 'failed' ? 202 : 201);
  }

  private createUserDirectMessage(agentId: string, otherId: string, body: unknown): Response {
    const target = this.getAgent(agentId);
    if (!target) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateDirectMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }

    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: parsed.data.fromAgentId ?? otherId,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    this.broadcast({ type: 'dm:new', dm });
    this.deliverDirectMessage(target, dm);
    return json(dm, 201);
  }

  private createUserDelegation(fromAgentId: string, toAgentId: string, body: unknown): Response {
    const from = this.getAgent(fromAgentId);
    if (!from) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateAgentDelegationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const delegation = this.delegateAgent({
      fromAgentId: from.id,
      toAgentId,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return json(delegation, delegation.status === 'failed' ? 202 : 201);
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
      envVars: payload.envVars,
      organization: payload.organization,
      machineId: payload.machineId,
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO agents
       (id, name, display_name, description, runtime, model, system_prompt, env_vars, organization, machine_id, status, auto_start, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agent.id,
      agent.name,
      agent.displayName ?? null,
      agent.description ?? null,
      agent.runtime,
      agent.model ?? null,
      agent.systemPrompt ?? null,
      agent.envVars ? JSON.stringify(agent.envVars) : null,
      agent.organization ? JSON.stringify(agent.organization) : null,
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
    if (updated) {
      this.broadcast({ type: 'agent:update', agent: updated });
      this.broadcast({ type: 'agent:updated', agent: updated });
    }
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
      config: this.toAgentRuntimeConfig(agent),
      launchId: crypto.randomUUID(),
      wakeMessage: this.openTaskSummaryDelivery(agent),
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

  private async readAgentWorkspace(agentId: string, relPath: string): Promise<Response> {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    if (isUnsafeWorkspacePath(relPath)) return json({ error: 'Path traversal is not allowed' }, 403);

    const machineId = this.resolveStartMachineId(agent);
    if (!machineId) return json({ error: 'No connected machine available for agent workspace' }, 503);

    const result = await this.readWorkspace(machineId, agent.id, relPath);
    if (result.type === 'error') return json({ error: result.error }, result.status ?? 500);
    return json(result);
  }

  private listChannels(): Channel[] {
    return this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels ORDER BY created_at').toArray().map(toChannel);
  }

  private getChannel(id: string): Channel | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toChannel(row) : undefined;
  }

  private createChannel(id: string, name: string): Channel {
    const channel: Channel = { id, name, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', channel.id, channel.name, channel.createdAt);
    return channel;
  }

  private deleteChannel(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM messages WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM reminders WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM channels WHERE id = ?', id);
  }

  private getMessage(id: string): Message | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM messages WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toMessage(row) : undefined;
  }

  private listMessages(channelId: string): Message[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', channelId)
      .toArray()
      .map(toMessage);
  }

  private listRecentMessages(channelId: string, limit: number): Message[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?', channelId, limit)
      .toArray()
      .map(toMessage)
      .reverse();
  }

  private searchMessages(query: string, limit: number) {
    const needle = query.toLowerCase();
    const channelMap = new Map(this.listChannels().map((channel) => [channel.id, channel.name]));
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000')
      .toArray()
      .map(toMessage)
      .filter((message) => message.content.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((message) => ({ ...message, channelName: channelMap.get(message.channelId) ?? message.channelId }));
  }

  private findChannel(value: string): Channel | undefined {
    const byId = this.getChannel(value);
    if (byId) return byId;
    return this.listChannels().find((channel) => channel.name === value);
  }

  private listTasks(filter: { channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Task[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM tasks ORDER BY created_at')
      .toArray()
      .map(toTask)
      .filter((task) =>
        (!filter.channelId || task.channelId === filter.channelId) &&
        (!filter.status || task.status === filter.status) &&
        (!filter.assigneeId || task.assigneeId === filter.assigneeId)
      );
  }

  private getTask(id: string): Task | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM tasks WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toTask(row) : undefined;
  }

  private listReminders(agentId?: string): Reminder[] {
    const rows = this.ctx.storage.sql.exec<Row>('SELECT * FROM reminders ORDER BY trigger_at').toArray().map(toReminder);
    return rows.filter((reminder) => !agentId || reminder.agentId === agentId);
  }

  private getReminder(id: string): Reminder | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM reminders WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toReminder(row) : undefined;
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

  private createTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const created: Task = { ...task, title: task.title.slice(0, 200), createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO tasks (id, channel_id, message_id, title, status, creator_name, assignee_id, context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.messageId ?? null,
      created.title,
      created.status,
      created.creatorName,
      created.assigneeId ?? null,
      created.context ? JSON.stringify(created.context) : null,
      created.createdAt,
      created.updatedAt
    );
    return created;
  }

  private createReminder(reminder: Omit<Reminder, 'createdAt'>): Reminder {
    const created: Reminder = { ...reminder, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO reminders (id, agent_id, channel_id, message, trigger_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.agentId,
      created.channelId,
      created.message,
      created.triggerAt,
      created.status,
      created.createdAt
    );
    return created;
  }

  private updateReminder(id: string, patch: Partial<Pick<Reminder, 'status'>>): Reminder | undefined {
    const existing = this.getReminder(id);
    if (!existing) return undefined;
    const updated: Reminder = { ...existing, status: patch.status ?? existing.status };
    this.ctx.storage.sql.exec('UPDATE reminders SET status = ? WHERE id = ?', updated.status, id);
    return updated;
  }

  private triggerDueReminders(now = new Date()): void {
    const due = this.listReminders().filter((reminder) => reminder.status === 'pending' && reminder.triggerAt <= now.toISOString());
    for (const reminder of due) {
      const latest = this.getReminder(reminder.id);
      if (!latest || latest.status !== 'pending') continue;
      const agent = this.getAgent(reminder.agentId);
      const message = this.createMessage({
        id: crypto.randomUUID(),
        channelId: reminder.channelId,
        agentId: reminder.agentId,
        senderName: agent?.displayName ?? agent?.name ?? reminder.agentId,
        content: reminder.message,
      });
      this.broadcast({ type: 'message:new', message });
      const updated = this.updateReminder(reminder.id, { status: 'triggered' });
      if (updated) this.broadcast({ type: 'reminder:update', reminder: updated });
    }
  }

  private updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'assigneeId' | 'context'>>): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const updated: Task = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      'UPDATE tasks SET status = ?, assignee_id = ?, context = ?, updated_at = ? WHERE id = ?',
      updated.status,
      updated.assigneeId ?? null,
      updated.context ? JSON.stringify(updated.context) : null,
      updated.updatedAt,
      id,
    );
    return updated;
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

  private createDirectMessage(dm: Omit<DirectMessage, 'createdAt'>): DirectMessage {
    const created: DirectMessage = { ...dm, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO direct_messages (id, from_agent_id, to_agent_id, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      created.id,
      created.fromAgentId,
      created.toAgentId,
      created.content,
      created.createdAt
    );
    return created;
  }

  private createAgentDelegation(delegation: Omit<AgentDelegation, 'createdAt'>): AgentDelegation {
    const created: AgentDelegation = { ...delegation, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO agent_delegations (id, from_agent_id, to_agent_id, content, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.fromAgentId,
      created.toAgentId,
      created.content,
      created.status,
      created.error ?? null,
      created.createdAt
    );
    return created;
  }

  private getOrCreateAgentToken(agentId: string): string {
    const existing = this.ctx.storage.sql.exec<Row>('SELECT * FROM agent_tokens WHERE agent_id = ? LIMIT 1', agentId).toArray()[0];
    if (existing?.token) return String(existing.token);
    const token = `xox_agent_${crypto.randomUUID().replaceAll('-', '')}`;
    this.ctx.storage.sql.exec(
      'INSERT INTO agent_tokens (agent_id, token, created_at) VALUES (?, ?, ?)',
      agentId,
      token,
      new Date().toISOString(),
    );
    return token;
  }

  private requireAgentAuth(request: Request, agentId: string): Response | undefined {
    if (request.headers.get('X-Agent-Id') !== agentId) return unauthorized('agent id mismatch');
    const provided = getBearerToken(request.headers.get('Authorization'));
    if (!provided) return unauthorized('missing bearer token');
    const expected = this.getOrCreateAgentToken(agentId);
    if (!timingSafeEqualStr(provided, expected)) return unauthorized('invalid token');
    return undefined;
  }

  private toAgentRuntimeConfig(agent: Agent) {
    return {
      ...toRuntimeConfig(agent),
      envVars: agent.envVars,
      agentToken: this.getOrCreateAgentToken(agent.id),
    };
  }

  private updateAgentDelegation(delegation: AgentDelegation, status: AgentDelegation['status'], error?: string): AgentDelegation {
    this.ctx.storage.sql.exec(
      'UPDATE agent_delegations SET status = ?, error = ? WHERE id = ?',
      status,
      error ?? null,
      delegation.id,
    );
    const updated = { ...delegation, status, error };
    this.broadcast({ type: 'agent:delegation', delegation: updated });
    return updated;
  }

  private listAgentDelegations(agentId: string): AgentDelegation[] {
    return this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM agent_delegations
         WHERE from_agent_id = ? OR to_agent_id = ?
         ORDER BY created_at DESC`,
        agentId,
        agentId,
      )
      .toArray()
      .map(toAgentDelegation);
  }

  private listDirectMessages(agentId: string, otherId: string): DirectMessage[] {
    return this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM direct_messages
         WHERE (from_agent_id = ? AND to_agent_id = ?)
            OR (from_agent_id = ? AND to_agent_id = ?)
         ORDER BY created_at`,
        agentId,
        otherId,
        otherId,
        agentId,
      )
      .toArray()
      .map(toDirectMessage);
  }

  private listDirectMessageThreads(agentId: string): DirectMessageThread[] {
    const rows = this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM direct_messages
         WHERE from_agent_id = ? OR to_agent_id = ?
         ORDER BY created_at DESC`,
        agentId,
        agentId,
      )
      .toArray()
      .map(toDirectMessage);
    const seen = new Set<string>();
    const threads: DirectMessageThread[] = [];
    for (const dm of rows) {
      const otherAgentId = dm.fromAgentId === agentId ? dm.toAgentId : dm.fromAgentId;
      if (seen.has(otherAgentId)) continue;
      seen.add(otherAgentId);
      threads.push({ otherAgentId, lastMessage: dm });
    }
    return threads;
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
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM agents WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toAgent(row) : undefined;
  }

  private findAgentByNameOrId(value: string): Agent | undefined {
    return resolveAgentReference(value, this.listAgents()).match;
  }

  private updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const existing = this.getAgent(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.ctx.storage.sql.exec(
      `UPDATE agents
       SET name = ?, display_name = ?, description = ?, runtime = ?, model = ?,
           system_prompt = ?, env_vars = ?, organization = ?, machine_id = ?, status = ?, auto_start = ?, created_at = ?
       WHERE id = ?`,
      updated.name,
      updated.displayName ?? null,
      updated.description ?? null,
      updated.runtime,
      updated.model ?? null,
      updated.systemPrompt ?? null,
      updated.envVars ? JSON.stringify(updated.envVars) : null,
      updated.organization ? JSON.stringify(updated.organization) : null,
      updated.machineId ?? null,
      updated.status,
      updated.autoStart ? 1 : 0,
      updated.createdAt,
      id
    );
    return updated;
  }

  private delegateAgent(input: { fromAgentId: string; toAgentId: string; content: string; startIfInactive?: boolean }): AgentDelegation {
    const target = this.findAgentByNameOrId(input.toAgentId);
    if (!target) {
      const failed = this.createAgentDelegation({
        id: crypto.randomUUID(),
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        content: input.content,
        status: 'failed',
        error: JSON.stringify({
          message: 'Target agent not found',
          resolve: resolveAgentReference(input.toAgentId, this.listAgents()),
        }),
      });
      this.broadcast({ type: 'agent:delegation', delegation: failed });
      return failed;
    }

    const queued = this.createAgentDelegation({
      id: crypto.randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: target.id,
      content: input.content,
      status: 'queued',
    });
    this.broadcast({ type: 'agent:delegation', delegation: queued });

    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: target.id,
      content: input.content,
    });
    this.broadcast({ type: 'dm:new', dm });

    if (['starting', 'running', 'working', 'idle'].includes(target.status) && target.machineId) {
      const sent = this.sendToDaemon(target.machineId, {
        type: 'agent:deliver',
        agentId: target.id,
        seq: Date.now(),
        channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
        config: this.toAgentRuntimeConfig(target),
        message: toDirectMessageDelivery(dm),
      });
      return this.updateAgentDelegation(queued, sent ? 'delivered' : 'failed', sent ? undefined : 'Machine not connected');
    }

    if (input.startIfInactive === false) {
      return queued;
    }

    const machineId = this.resolveStartMachineId(target);
    if (!machineId) {
      return this.updateAgentDelegation(queued, 'failed', 'No connected machine available for agent runtime');
    }

    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId: target.id,
      config: this.toAgentRuntimeConfig(target),
      launchId: crypto.randomUUID(),
      wakeMessage: toDirectMessageDelivery(dm),
    });
    if (!sent) {
      return this.updateAgentDelegation(queued, 'failed', 'Machine not connected');
    }
    const updated = this.updateAgent(target.id, { machineId, status: 'starting' });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return this.updateAgentDelegation(queued, 'started');
  }

  private notifyTaskAssignee(task: Task): void {
    if (!task.assigneeId || task.status === 'done') return;
    const target = this.findAgentByNameOrId(task.assigneeId);
    if (!target) return;
    const message = toTaskDelivery(task);

    if (['starting', 'running', 'working', 'idle'].includes(target.status) && target.machineId) {
      this.sendToDaemon(target.machineId, {
        type: 'agent:deliver',
        agentId: target.id,
        seq: Date.now(),
        channelId: message.channelId,
        config: this.toAgentRuntimeConfig(target),
        message,
      });
      return;
    }

    if (!target.autoStart) return;
    const machineId = this.resolveStartMachineId(target);
    if (!machineId) return;
    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId: target.id,
      config: this.toAgentRuntimeConfig(target),
      launchId: crypto.randomUUID(),
      wakeMessage: message,
    });
    if (!sent) return;
    const updated = this.updateAgent(target.id, { machineId, status: 'starting' });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
  }

  private openTaskSummaryDelivery(agent: Agent) {
    const tasks = this.listTasks({ assigneeId: agent.id }).filter((task) => task.status !== 'done').slice(0, 20);
    if (tasks.length === 0) return undefined;
    return {
      id: `tasks:${agent.id}:${Date.now()}`,
      channelId: `tasks:${agent.id}`,
      channelName: 'Assigned tasks',
      senderName: 'task-board',
      content: [
        'Open tasks assigned to you:',
        ...tasks.map((task) => {
          const goal = task.context?.goal ? ` goal: ${task.context.goal}` : '';
          return `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}${goal}`;
        }),
        '',
        'Use `xoxiang task read <taskId> --context`, `xoxiang task update <taskId> --status in_progress|in_review|done`, and `xoxiang task handoff <taskId> --to agentName --notes "..."` to manage them.',
      ].join('\n'),
      createdAt: new Date().toISOString(),
    };
  }

  private deliverDirectMessage(target: Agent, dm: DirectMessage): void {
    const machineId = this.resolveStartMachineId(target);
    if (!machineId || target.status === 'inactive') return;
    this.sendToDaemon(machineId, {
      type: 'agent:deliver',
      agentId: target.id,
      seq: Date.now(),
      channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
      config: this.toAgentRuntimeConfig(target),
      message: {
        id: dm.id,
        channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
        channelName: `DM from ${dm.fromAgentId}`,
        senderName: dm.fromAgentId,
        content: dm.content,
        createdAt: dm.createdAt,
      },
    });
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
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM machines WHERE id = ? LIMIT 1', machineId).toArray()[0];
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
        config: this.toAgentRuntimeConfig(agent),
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

  private readWorkspace(machineId: string, agentId: string, relPath: string): Promise<WorkspaceEntry | WorkspaceError> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Workspace read timed out', status: 504 });
      }, 5000);
      this.workspaceReads.set(requestId, { resolve, timeout });
      const sent = this.sendToDaemon(machineId, { type: 'workspace:read', agentId, requestId, relPath });
      if (!sent) {
        clearTimeout(timeout);
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Machine not connected', status: 503 });
      }
    });
  }

  private resolveWorkspaceRead(requestId: string, result: WorkspaceEntry | WorkspaceError): boolean {
    const pending = this.workspaceReads.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.workspaceReads.delete(requestId);
    pending.resolve(result);
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

function getBearerToken(header: string | null): string | undefined {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function isUnsafeWorkspacePath(value: string): boolean {
  return value.startsWith('/') || value.split(/[\\/]+/).some((part) => part === '..');
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

function toDirectMessage(row: Row): DirectMessage {
  return {
    id: String(row.id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function toAgentDelegation(row: Row): AgentDelegation {
  return {
    id: String(row.id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    content: String(row.content),
    status: String(row.status) as AgentDelegation['status'],
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
  };
}

function toTask(row: Row): Task {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    messageId: row.message_id ? String(row.message_id) : undefined,
    title: String(row.title),
    status: String(row.status) as TaskStatus,
    creatorName: String(row.creator_name),
    assigneeId: row.assignee_id ? String(row.assignee_id) : undefined,
    context: row.context ? JSON.parse(String(row.context)) as Task['context'] : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toReminder(row: Row): Reminder {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    channelId: String(row.channel_id),
    message: String(row.message),
    triggerAt: String(row.trigger_at),
    status: String(row.status) as ReminderStatus,
    createdAt: String(row.created_at),
  };
}

function toDirectMessageDelivery(dm: DirectMessage) {
  return {
    id: dm.id,
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    channelName: `DM from ${dm.fromAgentId}`,
    senderName: dm.fromAgentId,
    content: dm.content,
    createdAt: dm.createdAt,
  };
}

function toTaskDelivery(task: Task) {
  return {
    id: `task:${task.id}:${task.updatedAt}`,
    channelId: `task:${task.id}`,
    channelName: `Task ${task.id}`,
    senderName: 'task-board',
    content: [
      `Task assigned or updated: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      `Channel: ${task.channelId}`,
      task.context?.goal ? `Goal: ${task.context.goal}` : undefined,
      task.context?.background ? `Background: ${task.context.background}` : undefined,
      task.context?.handoffNotes?.length ? `Latest handoff: ${task.context.handoffNotes.at(-1)}` : undefined,
      '',
      'Use `xoxiang task read <taskId> --context` for details and `xoxiang task update <taskId> --status in_progress|in_review|done` when you make progress.',
    ].filter(Boolean).join('\n'),
    createdAt: task.updatedAt,
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
    envVars: row.env_vars ? JSON.parse(String(row.env_vars)) as Record<string, string> : undefined,
    organization: row.organization ? JSON.parse(String(row.organization)) as Agent['organization'] : undefined,
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
