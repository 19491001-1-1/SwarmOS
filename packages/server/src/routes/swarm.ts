import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { createSwarm, getSwarm, listSwarms } from '../swarmStore.js';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { toAgentRuntimeConfig } from '../runtimeConfig.js';
import { buildOpenTaskSummary } from '../taskDelivery.js';

export async function swarmRoutes(app: FastifyInstance) {
  app.post('/api/v1/swarm/init', async (req, reply) => {
    const body = req.body as any;
    if (!body || typeof body.channel_id !== 'string' || !Array.isArray(body.agents)) {
      return reply.status(400).send({ error: 'Invalid swarm init body. Expect { channel_id, agents[] }' });
    }

    const store = getStore();
    const channelId = body.channel_id;
    const agentConfigs: Array<{ agent_id: string; role?: string; model?: string; system_prompt?: string; allowed_tools?: string[] }> = body.agents.map((a: any) => ({
      agent_id: a.agent_id ?? a.agentId ?? a.id ?? 'unknown',
      role: a.role,
      model: a.model,
      system_prompt: a.system_prompt ?? a.systemPrompt,
      allowed_tools: a.allowed_tools ?? a.allowedTools,
    }));

    // Resolve or create agents, and prepare runtime configs for each
    const resolvedAgents: Array<{ agent_id: string; runtimeConfig?: any; error?: string; machineId?: string }> = [];

    for (const cfg of agentConfigs) {
      const agentId = cfg.agent_id;
      let agent = await store.getAgent(agentId);

      if (!agent) {
        // Auto-create the agent if it doesn't exist
        agent = await store.createAgent({
          id: agentId,
          name: agentId,
          displayName: cfg.role ? `${cfg.role} (${agentId})` : agentId,
          description: cfg.system_prompt?.slice(0, 200),
          runtime: 'claude',
          model: cfg.model ?? undefined,
          systemPrompt: cfg.system_prompt ?? undefined,
          status: 'inactive',
          createdAt: new Date().toISOString(),
        });
      }

      // Find a machine for this agent
      let machineId = agent.machineId;
      if (!machineId) {
        const machines = await store.listMachines();
        const onlineMachine = machines.find((m) => m.status === 'online');
        if (onlineMachine) {
          machineId = onlineMachine.id;
          await store.updateAgent(agent.id, { machineId });
          agent = { ...agent, machineId };
        }
      }

      if (machineId) {
        // Send start command to daemon
        try {
          const runtimeConfig = await toAgentRuntimeConfig(agent);
          const inboxSummary = await buildOpenTaskSummary(agent);
          const launchId = nanoid();
          const sent = daemonRegistry.send(machineId, {
            type: 'agent:start',
            agentId: agent.id,
            config: runtimeConfig,
            launchId,
            inboxSummary,
          });
          if (sent) {
            const updated = await store.updateAgentStatus(agent.id, 'starting');
            if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
            resolvedAgents.push({ agent_id: agent.id, runtimeConfig, machineId });
          } else {
            resolvedAgents.push({ agent_id: agent.id, error: 'Daemon registered but send failed', machineId });
          }
        } catch (e: any) {
          resolvedAgents.push({ agent_id: agent.id, error: e?.message ?? 'Failed to prepare runtime config' });
        }
      } else {
        resolvedAgents.push({ agent_id: agent.id, error: 'No online machine available' });
      }
    }

    // Create swarm session
    const swarm = createSwarm(channelId, resolvedAgents.map((a) => ({ agent_id: a.agent_id })));

    const errorCount = resolvedAgents.filter((a) => a.error).length;
    const resolvedCount = resolvedAgents.filter((a) => a.runtimeConfig).length;

    // Notify mock server for integration testing
    const mockUrl = process.env.MOCK_SERVER_URL || 'http://localhost:4001/api/v1/events';
    try {
      const fetchImpl = globalThis.fetch ?? (await import('node-fetch')).default;
      await fetchImpl(mockUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'swarm:init',
          swarm_id: swarm.id,
          channel_id: swarm.channelId,
          agent_count: resolvedAgents.length,
          resolved_count: resolvedCount,
          error_count: errorCount,
        }),
      });
    } catch (e) {
      app.log.warn('Failed to notify mock server: %s', String(e));
    }

    return reply.status(201).send({
      protocol_version: body.protocol_version ?? 'v1.0.0',
      swarm_id: swarm.id,
      channel_id: swarm.channelId,
      agent_count: resolvedAgents.length,
      status: errorCount > 0 ? (resolvedCount > 0 ? 'partial' : 'failed') : 'initialized',
      agents: resolvedAgents.map((a) => ({
        agent_id: a.agent_id,
        status: a.error ? 'error' : 'starting',
        error: a.error,
      })),
    });
  });

  app.get('/api/v1/swarms', async () => {
    return listSwarms();
  });

  app.get('/api/v1/swarms/:id', async (req, reply) => {
    const { id } = req.params as any;
    const swarm = getSwarm(id);
    if (!swarm) return reply.status(404).send({ error: 'Swarm not found' });
    return swarm;
  });
}
