import type { FastifyInstance } from 'fastify';
import { getStore } from '../db.js';

export async function channelRoutes(app: FastifyInstance) {
  app.get('/api/channels', async () => {
    return getStore().listChannels();
  });

  app.get<{ Params: { id: string } }>('/api/channels/:id/messages', async (req, reply) => {
    const channel = await getStore().getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listMessages(req.params.id);
  });
}
