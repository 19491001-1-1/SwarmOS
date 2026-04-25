import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { CreateAgentRequestSchema, CreateDirectMessageRequestSchema, PatchAgentRequestSchema, type Agent, type DirectMessage } from '@mini-slock/shared';
import { resolveStartMachineId, toRuntimeConfig } from '@mini-slock/hub-core';

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async () => {
    return getStore().listAgents();
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/activities', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listAgentActivities(agent.id, 200);
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/agents/:id/workspace', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const relPath = req.query.path ?? '';
    if (isUnsafeWorkspacePath(relPath)) {
      return reply.status(403).send({ error: 'Path traversal is not allowed' });
    }

    const machineId = resolveStartMachineId({
      agent,
      machines: await store.listMachines(),
      connectedMachineIds: new Set(daemonRegistry.listConnectedMachineIds()),
    });
    if (!machineId) return reply.status(503).send({ error: 'No connected machine available for agent workspace' });

    const result = await daemonRegistry.readWorkspace(machineId, agent.id, nanoid(), relPath);
    if (result.type === 'error') {
      return reply.status(result.status ?? 500).send({ error: result.error });
    }
    return result;
  });

  app.post('/api/agents', async (req, reply) => {
    const parsed = CreateAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const { name, displayName, description, runtime, model, systemPrompt, machineId } = parsed.data;

    const agent = await getStore().createAgent({
      id: nanoid(),
      name,
      displayName,
      description,
      runtime,
      model,
      systemPrompt,
      machineId,
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    });
    return reply.status(201).send(agent);
  });

  app.patch<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = PatchAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const updated = await store.updateAgent(agent.id, parsed.data);
    if (updated) {
      eventBus.emit({ type: 'agent:update', agent: updated });
      eventBus.emit({ type: 'agent:updated', agent: updated });
    }
    return updated;
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/dms', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listDirectMessageThreads(agent.id);
  });

  app.get<{ Params: { id: string; otherId: string } }>('/api/agents/:id/dms/:otherId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listDirectMessages(agent.id, req.params.otherId);
  });

  app.post<{ Params: { id: string; otherId: string } }>('/api/agents/:id/dms/:otherId', async (req, reply) => {
    const store = getStore();
    const target = await store.getAgent(req.params.id);
    if (!target) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateDirectMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const dm = await store.createDirectMessage({
      id: nanoid(),
      fromAgentId: parsed.data.fromAgentId ?? req.params.otherId,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'dm:new', dm });
    deliverDirectMessage(target, dm);
    return reply.status(201).send(dm);
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/start', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const machineId = resolveStartMachineId({
      agent,
      machines: await store.listMachines(),
      connectedMachineIds: new Set(daemonRegistry.listConnectedMachineIds()),
    });
    if (!machineId) return reply.status(503).send({ error: 'No connected machine available for agent runtime' });

    const launchId = nanoid();
    const sent = daemonRegistry.send(machineId, {
      type: 'agent:start',
      agentId: agent.id,
      config: toRuntimeConfig(agent),
      launchId,
    });

    if (!sent) return reply.status(503).send({ error: 'Machine not connected' });

    const updated = (await store.updateAgent(agent.id, { machineId, status: 'starting', autoStart: true }))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/stop', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!agent.machineId) return reply.status(400).send({ error: 'Agent has no machine assigned' });

    daemonRegistry.send(agent.machineId, { type: 'agent:stop', agentId: agent.id });
    const updated = (await store.updateAgent(agent.id, { status: 'inactive', autoStart: false }))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });
}

function isUnsafeWorkspacePath(value: string): boolean {
  return value.startsWith('/') || value.split(/[\\/]+/).some((part) => part === '..');
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
