import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { CreateMessageRequestSchema } from '@mini-slock/shared';
import { toAgentDelivery, toRuntimeConfig } from '@mini-slock/hub-core';

export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/channels/:id/messages', async (req, reply) => {
    const store = getStore();
    const channel = await store.getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const parsed = CreateMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const { senderName, content, agentId } = parsed.data;

    const message = await store.createMessage({
      id: nanoid(),
      channelId: req.params.id,
      senderName,
      content,
      agentId,
    });

    eventBus.emit({ type: 'message:new', message });

    if (agentId) {
      const agent = await store.getAgent(agentId);
      if (agent?.machineId && agent.status !== 'inactive') {
        daemonRegistry.send(agent.machineId, {
          type: 'agent:deliver',
          agentId,
          seq: Date.now(),
          message: toAgentDelivery(message, channel),
          channelId: channel.id,
          config: toRuntimeConfig(agent),
        });
      }
    }

    return reply.status(201).send(message);
  });
}
