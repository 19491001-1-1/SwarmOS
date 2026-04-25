import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import { eventBus } from '../events.js';
import { validateBrowserToken } from '../browserAuth.js';

export async function browserSocketHandler(app: FastifyInstance) {
  app.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const query = request.query as { token?: string };
      if (!validateBrowserToken(query.token)) {
        reply.code(401).send('Unauthorized');
      }
    },
  }, (connection: SocketStream) => {
    const unsubscribe = eventBus.subscribe((event) => {
      if (connection.socket.readyState === 1) {
        connection.socket.send(JSON.stringify(event));
      }
    });

    connection.socket.on('close', () => unsubscribe());
  });
}
