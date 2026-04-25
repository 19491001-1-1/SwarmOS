import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import {
  createVersionInfo,
  CreateReminderRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalDmSendRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskUpdateRequestSchema,
  PatchReminderRequestSchema,
  type Agent,
  type DirectMessage,
} from '@mini-slock/shared';
import { toRuntimeConfig } from '@mini-slock/hub-core';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { delegateAgent } from '../delegation.js';
import { notifyTaskAssignee } from '../taskDelivery.js';

export async function internalAgentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/agent/')) return;
    const agentId = (req.params as { agentId?: string }).agentId;
    if (!agentId) return reply.status(401).send({ error: 'Missing agent id' });
    const headerAgentId = req.headers['x-agent-id'];
    if (headerAgentId !== agentId) return reply.status(401).send({ error: 'Agent id mismatch' });
    const token = bearerToken(req);
    if (!token) return reply.status(401).send({ error: 'Missing bearer token' });
    const valid = await getStore().verifyAgentToken(agentId, token);
    if (!valid) return reply.status(401).send({ error: 'Invalid agent token' });
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/auth/whoami', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return { agent };
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/server/info', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return {
      agent,
      channels: await store.listChannels(),
      agents: await store.listAgents(),
      version: createVersionInfo('server', {
        version: process.env.XOXIANG_VERSION,
        commit: process.env.XOXIANG_COMMIT_SHA ?? process.env.GITHUB_SHA,
        build: process.env.XOXIANG_BUILD_ID ?? process.env.GITHUB_RUN_ID,
      }),
    };
  });

  app.get<{ Params: { agentId: string }; Querystring: { query?: string } }>('/internal/agent/:agentId/agents/resolve', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentResolveRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return getStore().resolveAgent(parsed.data.query);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/send', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const message = await store.createMessage({
      id: nanoid(),
      channelId: channel.id,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'message:new', message });
    return reply.status(201).send(message);
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/check', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const channels = await store.listChannels();
    const channelSummaries = await Promise.all(channels.map(async (channel) => {
      const latest = (await store.listRecentMessages(channel.id, 1))[0];
      return { channelId: channel.id, channelName: channel.name, count: latest ? 1 : 0, latestMessage: latest };
    }));
    const dms = (await store.listDirectMessageThreads(agent.id)).map((thread) => ({
      otherAgentId: thread.otherAgentId,
      count: 1,
      latestMessage: thread.lastMessage,
    }));
    return { channels: channelSummaries, dms };
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; limit?: string } }>('/internal/agent/:agentId/messages/read', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageReadRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listRecentMessages(channel.id, parsed.data.limit);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/dms/send', async (req, reply) => {
    const store = getStore();
    const from = await store.getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalDmSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });

    const dm = await store.createDirectMessage({
      id: nanoid(),
      fromAgentId: from.id,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'dm:new', dm });
    deliverDirectMessage(target, dm);
    return reply.status(201).send(dm);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/delegate', async (req, reply) => {
    const from = await getStore().getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentDelegateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const delegation = await delegateAgent({
      fromAgentId: from.id,
      toAgentId: parsed.data.to,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return reply.status(delegation.status === 'failed' ? 202 : 201).send(delegation);
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; status?: string; all?: string } }>('/internal/agent/:agentId/tasks', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalTaskListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = parsed.data.channel ? await findChannel(parsed.data.channel) : undefined;
    if (parsed.data.channel && !channel) return reply.status(404).send({ error: 'Channel not found' });
    const tasks = await store.listTasks({
      channelId: channel?.id,
      status: parsed.data.status,
      assigneeId: parsed.data.all ? undefined : agent.id,
    });
    return tasks;
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listReminders(agent.id);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateReminderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const reminder = await store.createReminder({
      id: nanoid(),
      agentId: agent.id,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    eventBus.emit({ type: 'reminder:update', reminder });
    return reply.status(201).send(reminder);
  });

  app.post<{ Params: { agentId: string; reminderId: string } }>('/internal/agent/:agentId/reminders/:reminderId/cancel', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = PatchReminderRequestSchema.safeParse({ status: 'cancelled' });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await store.getReminder(req.params.reminderId);
    if (!existing || existing.agentId !== agent.id) return reply.status(404).send({ error: 'Reminder not found' });
    const reminder = await store.updateReminder(existing.id, { status: parsed.data.status });
    if (reminder) eventBus.emit({ type: 'reminder:update', reminder });
    return reminder;
  });

  app.get<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const task = await store.getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.assigneeId && task.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/update', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const task = await store.updateTask(req.params.taskId, parsed.data);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/handoff', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskHandoffRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });
    const nextNote = [
      `from ${agent.displayName ?? agent.name}: ${parsed.data.notes}`,
      parsed.data.nextStep ? `next: ${parsed.data.nextStep}` : undefined,
    ].filter(Boolean).join('\n');
    const task = await store.updateTask(existing.id, {
      assigneeId: target.id,
      context: {
        ...existing.context,
        goal: parsed.data.goal ?? existing.context?.goal,
        previousAgentId: agent.id,
        handoffNotes: [...(existing.context?.handoffNotes ?? []), nextNote],
      },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return task;
  });
}

function bearerToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  const match = typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/i) : undefined;
  return match?.[1];
}

async function findChannel(value: string) {
  const store = getStore();
  const byId = await store.getChannel(value);
  if (byId) return byId;
  return (await store.listChannels()).find((channel) => channel.name === value);
}

function deliverDirectMessage(target: Agent, dm: DirectMessage): void {
  if (!target.machineId || target.status === 'inactive') return;
  daemonRegistry.send(target.machineId, {
    type: 'agent:deliver',
    agentId: target.id,
    seq: Date.now(),
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    config: toRuntimeConfig(target),
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
