import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { agentRoutes } from './routes/agents.js';
import { machineRoutes } from './routes/machines.js';
import { daemonSocketHandler } from './ws/daemonSocket.js';
import { browserSocketHandler } from './ws/browserSocket.js';
import { initDb } from './db.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  await initDb();

  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(agentRoutes);
  await app.register(machineRoutes);
  await app.register(daemonSocketHandler);
  await app.register(browserSocketHandler);

  return app;
}
