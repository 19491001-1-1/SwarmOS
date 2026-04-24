import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { resetStore, getStore } from '../src/db.js';
import type { FastifyInstance } from 'fastify';

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

function connectDaemon(key: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=${key}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndWait(ws: WebSocket, msg: unknown, ms = 80): Promise<void> {
  ws.send(JSON.stringify(msg));
  return new Promise((r) => setTimeout(r, ms));
}

function waitForDaemonMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) resolve(msg);
    });
  });
}

describe('daemon WebSocket', () => {
  it('accepts connection with valid key', async () => {
    const ws = await connectDaemon('dev-machine-key');
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('rejects connection with invalid key', async () => {
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=bad-key`);
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(-1));
    });
    // 4001 = our custom close, 1006 = abnormal (also means rejected)
    expect([4001, 1006]).toContain(closed);
  });

  it('registers machine on ready message', async () => {
    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'test-machine',
      hostname: 'testhost',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });
    const machine = await getStore().getMachine('test-machine');
    expect(machine?.hostname).toBe('testhost');
    expect(machine?.status).toBe('online');
    ws.close();
  });

  it('creates channel message on agent:message', async () => {
    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    await sendAndWait(ws, {
      type: 'agent:message',
      agentId: 'agent-1',
      channelId: 'general',
      content: 'Hello from agent',
    });

    const messages = await store.listMessages('general');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello from agent');
    ws.close();
  });

  it('updates agent status on agent:status', async () => {
    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'starting',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    await sendAndWait(ws, { type: 'agent:status', agentId: 'agent-1', status: 'running' });

    expect((await store.getAgent('agent-1'))?.status).toBe('running');
    ws.close();
  });

  it('reuses machine id after daemon reconnect and can start a bound agent', async () => {
    const first = await connectDaemon('dev-machine-key');
    await sendAndWait(first, {
      type: 'ready',
      hostname: 'same-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const [machine] = await getStore().listMachines();
    const originalMachineId = machine.id;
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const second = await connectDaemon('dev-machine-key');
    await sendAndWait(second, {
      type: 'ready',
      hostname: 'same-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const machines = await getStore().listMachines();
    expect(machines).toHaveLength(1);
    expect(machines[0].id).toBe(originalMachineId);
    expect(machines[0].status).toBe('online');

    await getStore().createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: originalMachineId,
      createdAt: new Date().toISOString(),
    });

    const startMessage = waitForDaemonMessage(second, 'agent:start');
    const res = await app.inject({ method: 'POST', url: '/api/agents/agent-1/start' });
    expect(res.statusCode).toBe(200);
    expect((await startMessage).agentId).toBe('agent-1');
    second.close();
  });
});
