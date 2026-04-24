import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import { eventBus } from '../events.js';

export async function browserSocketHandler(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (connection: SocketStream) => {
    const unsubscribe = eventBus.subscribe((event) => {
      if (connection.socket.readyState === 1) {
        connection.socket.send(JSON.stringify(event));
      }
    });

    connection.socket.on('close', () => unsubscribe());
  });
}
