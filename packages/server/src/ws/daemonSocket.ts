import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { DaemonToServerSchema } from '@mini-slock/shared';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';

const VALID_KEYS = new Set(['dev-machine-key']);

export async function daemonSocketHandler(app: FastifyInstance) {
  app.get(
    '/daemon/connect',
    { websocket: true },
    (connection: SocketStream, req: FastifyRequest) => {
      const url = new URL(req.url!, `http://localhost`);
      const key = url.searchParams.get('key');

      if (!key || !VALID_KEYS.has(key)) {
        connection.socket.close(4001, 'Unauthorized');
        return;
      }

      let machineId: string | null = null;

      connection.socket.on('message', async (raw) => {
        let data: unknown;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const parsed = DaemonToServerSchema.safeParse(data);
        if (!parsed.success) return;

        const msg = parsed.data;
        const store = getStore();

        if (msg.type === 'ready') {
          machineId = msg.machineId ?? nanoid();
          const machine = await store.upsertMachine({
            id: machineId,
            hostname: msg.hostname,
            os: msg.os,
            daemonVersion: msg.daemonVersion,
            runtimes: msg.runtimes,
            runtimeVersions: msg.runtimeVersions,
            status: 'online',
            connectedAt: new Date().toISOString(),
          });
          daemonRegistry.register(machineId, connection.socket);
          eventBus.emit({ type: 'machine:update', machine });
          return;
        }

        if (!machineId) return;

        if (msg.type === 'pong') return;

        if (msg.type === 'agent:status') {
          const agent = await store.updateAgentStatus(msg.agentId, msg.status);
          if (agent) eventBus.emit({ type: 'agent:update', agent });
          return;
        }

        if (msg.type === 'agent:message') {
          const channel = await store.getChannel(msg.channelId);
          if (!channel) return;
          const agent = await store.getAgent(msg.agentId);
          const message = await store.createMessage({
            id: nanoid(),
            channelId: msg.channelId,
            agentId: msg.agentId,
            senderName: agent?.displayName ?? agent?.name ?? msg.agentId,
            content: msg.content,
          });
          eventBus.emit({ type: 'message:new', message });
          return;
        }

        if (msg.type === 'agent:activity') {
          return;
        }

        if (msg.type === 'agent:deliver:ack') {
          return;
        }
      });

      connection.socket.on('close', async () => {
        if (machineId) {
          daemonRegistry.unregister(machineId);
          const store = getStore();
          await store.setMachineOffline(machineId);
          const machine = await store.getMachine(machineId);
          if (machine) eventBus.emit({ type: 'machine:update', machine });
        }
      });

      const pingInterval = setInterval(() => {
        if (connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      connection.socket.on('close', () => clearInterval(pingInterval));
    }
  );
}
