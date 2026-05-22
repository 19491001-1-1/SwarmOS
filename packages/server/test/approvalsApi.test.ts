import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

let app: FastifyInstance;
let port: number;

beforeEach(async () => {
  await resetStore();
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address ? address.port : 3000;
});

afterEach(async () => {
  await app.close();
});

function connectDaemon(machineId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=dev-machine-key`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'ready',
        machineId,
        hostname: `${machineId}-host`,
        os: 'linux',
        daemonVersion: '0.1.0',
        runtimes: ['claude'],
        runtimeVersions: { claude: '1.0' },
        runningAgents: [],
        capabilities: [],
      }));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function collectMessages(ws: WebSocket): any[] {
  const messages: any[] = [];
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
  });
  return messages;
}

function closeSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('approval routes', () => {
  it('targets approval notifications to the owning daemon machine', async () => {
    const daemonA = await connectDaemon('machine-a');
    const daemonB = await connectDaemon('machine-b');
    const messagesA = collectMessages(daemonA);
    const messagesB = collectMessages(daemonB);

    const store = getStore();
    await store.createAgent({
      id: 'agent-a',
      name: 'agent-a',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-a',
      createdAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-b',
      name: 'agent-b',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-b',
      createdAt: new Date().toISOString(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      payload: { action_id: 'act-1', agent_id: 'agent-a', reason: 'danger' },
    });
    expect(created.statusCode).toBe(201);
    const approval = created.json();

    const decided = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decision`,
      payload: { approved: true, reviewer: 'reviewer-1' },
    });
    expect(decided.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(messagesA.some((msg) => msg.type === 'approval:resolved' && msg.approval?.id === approval.id)).toBe(true);
    expect(messagesB.some((msg) => msg.type === 'approval:resolved' && msg.approval?.id === approval.id)).toBe(false);

    await closeSocket(daemonA);
    await closeSocket(daemonB);
  });
});