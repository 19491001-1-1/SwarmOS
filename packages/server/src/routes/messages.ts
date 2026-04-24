import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import type { AgentDelivery } from '@mini-slock/shared';

export async function messageRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { senderName: string; content: string; agentId?: string };
  }>('/api/channels/:id/messages', async (req, reply) => {
    const store = getStore();
    const channel = store.getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const { senderName, content, agentId } = req.body;
    if (!senderName || !content) return reply.status(400).send({ error: 'senderName and content required' });

    const message = store.createMessage({
      id: nanoid(),
      channelId: req.params.id,
      senderName,
      content,
      agentId,
    });

    eventBus.emit({ type: 'message:new', message });

    if (agentId) {
      const agent = store.getAgent(agentId);
      if (agent?.machineId && agent.status !== 'inactive') {
        const delivery: AgentDelivery = {
          id: message.id,
          channelId: channel.id,
          channelName: channel.name,
          senderName,
          content,
          createdAt: message.createdAt,
        };
        daemonRegistry.send(agent.machineId, {
          type: 'agent:deliver',
          agentId,
          seq: Date.now(),
          message: delivery,
          channelId: channel.id,
          config: {
            runtime: agent.runtime,
            model: agent.model,
            name: agent.name,
            displayName: agent.displayName,
            description: agent.description,
            systemPrompt: agent.systemPrompt,
          },
        });
      }
    }

    return reply.status(201).send(message);
  });
}
