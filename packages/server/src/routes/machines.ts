import type { FastifyInstance } from 'fastify';
import { getStore } from '../db.js';

export async function machineRoutes(app: FastifyInstance) {
  app.get('/api/machines', async () => {
    return getStore().listMachines();
  });
}
