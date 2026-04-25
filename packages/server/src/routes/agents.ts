import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { CreateAgentRequestSchema, PatchAgentRequestSchema } from '@mini-slock/shared';
import { resolveStartMachineId, toRuntimeConfig } from '@mini-slock/hub-core';

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async () => {
    return getStore().listAgents();
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/activities', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listAgentActivities(agent.id, 200);
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
    if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
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

    const updated = (await store.updateAgent(agent.id, { machineId, status: 'starting' }))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/stop', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!agent.machineId) return reply.status(400).send({ error: 'Agent has no machine assigned' });

    daemonRegistry.send(agent.machineId, { type: 'agent:stop', agentId: agent.id });
    const updated = (await store.updateAgentStatus(agent.id, 'inactive'))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });
}
