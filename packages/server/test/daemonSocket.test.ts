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

function waitForWorkspaceRead(ws: WebSocket, result: unknown): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'workspace:read') return;
      ws.send(JSON.stringify({ type: 'workspace:result', requestId: msg.requestId, result }));
      resolve(msg);
    });
  });
}

function connectBrowser(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForBrowserEvent(ws: WebSocket, type: string): Promise<any> {
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

  it('restores known daemon machines after server restart', async () => {
    await getStore().upsertMachine({
      id: 'known-machine',
      hostname: 'known-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      status: 'online',
      connectedAt: new Date().toISOString(),
    });

    await app.close();
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 3000;

    const machines = await getStore().listMachines();
    expect(machines).toEqual([
      expect.objectContaining({
        id: 'known-machine',
        hostname: 'known-host',
        status: 'offline',
      }),
    ]);
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

  it('keeps daemon agent replies inside the delivered thread', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    await sendAndWait(daemon, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      displayName: 'Bot',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    const root = await store.createMessage({
      id: 'root-1',
      channelId: 'general',
      senderName: 'user',
      content: 'Root',
    });

    await sendAndWait(daemon, {
      type: 'agent:message',
      agentId: 'agent-1',
      channelId: 'general',
      content: 'Agent thread reply',
      inReplyToMessageId: root.id,
    });

    const listed = await store.listMessages('general');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: root.id, replyCount: 1 });
    const thread = await store.getThread(root.id);
    expect(thread?.replies).toHaveLength(1);
    expect(thread?.replies[0]).toMatchObject({
      agentId: 'agent-1',
      senderName: 'Bot',
      content: 'Agent thread reply',
      threadRootId: root.id,
    });
    daemon.close();
  });

  it('delivers thread mentions to agents with thread context', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    await sendAndWait(daemon, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      displayName: 'Bot',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });
    const root = await store.createMessage({
      id: 'root-mention',
      channelId: 'general',
      senderName: 'user',
      content: 'Root',
    });

    const deliverPromise = waitForDaemonMessage(daemon, 'agent:deliver');
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: '@Bot please answer in thread', threadRootId: root.id },
    });
    expect(res.statusCode).toBe(201);
    const delivered = await deliverPromise;
    expect(delivered.agentId).toBe('agent-1');
    expect(delivered.message).toMatchObject({
      channelId: 'general',
      threadRootId: root.id,
      content: '@Bot please answer in thread',
    });
    daemon.close();
  });

  it('creates and updates tasks from daemon task events', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    const browser = await connectBrowser();
    await sendAndWait(daemon, {
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

    const createEvent = waitForBrowserEvent(browser, 'task:update');
    await sendAndWait(daemon, {
      type: 'agent:create_task',
      agentId: 'agent-1',
      channelId: 'general',
      title: 'daemon made task',
    });
    const created = await createEvent;
    expect(created.task.title).toBe('daemon made task');
    expect((await store.listTasks())[0].creatorName).toBe('bot');

    const updateEvent = waitForBrowserEvent(browser, 'task:update');
    await sendAndWait(daemon, {
      type: 'agent:update_task',
      agentId: 'agent-1',
      taskId: created.task.id,
      status: 'done',
    });
    const updated = await updateEvent;
    expect(updated.task.status).toBe('done');
    browser.close();
    daemon.close();
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

  it('stores and broadcasts agent activity from daemon', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    const browser = await connectBrowser();
    await sendAndWait(daemon, {
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

    const eventPromise = waitForBrowserEvent(browser, 'agent:activity');
    await sendAndWait(daemon, {
      type: 'agent:activity',
      agentId: 'agent-1',
      activityType: 'sending',
      detail: 'channel:general',
    });

    const event = await eventPromise;
    expect(event.agentId).toBe('agent-1');
    expect(event.activity.type).toBe('sending');
    expect(event.activity.detail).toBe('channel:general');
    const activities = await store.listAgentActivities('agent-1');
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe('sending');
    browser.close();
    daemon.close();
  });

  it('stores, broadcasts, and delivers agent dm from daemon', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    const browser = await connectBrowser();
    await sendAndWait(daemon, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'sender',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-2',
      name: 'receiver',
      runtime: 'claude',
      status: 'running',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    const eventPromise = waitForBrowserEvent(browser, 'dm:new');
    const deliverPromise = waitForDaemonMessage(daemon, 'agent:deliver');
    await sendAndWait(daemon, {
      type: 'agent:dm',
      fromAgentId: 'agent-1',
      toAgentId: 'receiver',
      content: 'secret hello',
    });

    const event = await eventPromise;
    expect(event.dm).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'secret hello' });
    const deliver = await deliverPromise;
    expect(deliver.agentId).toBe('agent-2');
    expect(deliver.message.content).toBe('secret hello');
    expect(await store.listDirectMessages('agent-2', 'agent-1')).toHaveLength(1);
    browser.close();
    daemon.close();
  });

  it('delivers delegation to a running target agent', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    const browser = await connectBrowser();
    await sendAndWait(daemon, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'sender', runtime: 'claude', status: 'running', machineId: 'machine-1', createdAt: new Date().toISOString() });
    await store.createAgent({ id: 'agent-2', name: 'receiver', runtime: 'claude', status: 'running', machineId: 'machine-1', createdAt: new Date().toISOString() });

    const delegationEvent = waitForBrowserEvent(browser, 'agent:delegation');
    const deliverPromise = waitForDaemonMessage(daemon, 'agent:deliver');
    await sendAndWait(daemon, {
      type: 'agent:delegate',
      fromAgentId: 'agent-1',
      toAgentId: 'receiver',
      content: 'please handle this',
    });

    const deliver = await deliverPromise;
    expect(deliver.agentId).toBe('agent-2');
    expect(deliver.message.content).toBe('please handle this');
    const event = await delegationEvent;
    expect(['queued', 'delivered']).toContain(event.delegation.status);
    const delegations = await store.listAgentDelegations('agent-1');
    expect(delegations[0]).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'please handle this', status: 'delivered' });
    expect(await store.listDirectMessages('agent-2', 'agent-1')).toHaveLength(1);
    browser.close();
    daemon.close();
  });

  it('starts an inactive delegation target with a wake message', async () => {
    const daemon = await connectDaemon('dev-machine-key');
    await sendAndWait(daemon, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'sender', runtime: 'claude', status: 'running', machineId: 'machine-1', createdAt: new Date().toISOString() });
    await store.createAgent({ id: 'agent-2', name: 'receiver', runtime: 'claude', status: 'inactive', createdAt: new Date().toISOString() });

    const startPromise = waitForDaemonMessage(daemon, 'agent:start');
    await sendAndWait(daemon, {
      type: 'agent:delegate',
      fromAgentId: 'agent-1',
      toAgentId: 'receiver',
      content: 'wake up and work',
    });

    const start = await startPromise;
    expect(start.agentId).toBe('agent-2');
    expect(start.wakeMessage.content).toBe('wake up and work');
    expect((await store.getAgent('agent-2'))?.status).toBe('starting');
    expect((await store.listAgentDelegations('agent-1'))[0].status).toBe('started');
    daemon.close();
  });

  it('records failed delegation when no compatible machine is available', async () => {
    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'sender', runtime: 'claude', status: 'running', createdAt: new Date().toISOString() });
    await store.createAgent({ id: 'agent-2', name: 'receiver', runtime: 'claude', status: 'inactive', createdAt: new Date().toISOString() });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/delegate/receiver',
      payload: { content: 'work without machine' },
    });
    expect(res.statusCode).toBe(202);
    const delegation = res.json();
    expect(delegation.status).toBe('failed');
    expect(delegation.error).toContain('No connected machine');
    expect(await store.listDirectMessages('agent-2', 'agent-1')).toHaveLength(1);
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
    expect((await getStore().getAgent('agent-1'))?.autoStart).toBe(true);
    second.close();
  });

  it('auto-starts enabled agents when daemon reports ready', async () => {
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'engineer',
      runtime: 'claude',
      status: 'inactive',
      autoStart: true,
      createdAt: new Date().toISOString(),
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'engineer claimable task', creatorName: 'user' },
    });

    const ws = await connectDaemon('dev-machine-key');
    const startMessage = waitForDaemonMessage(ws, 'agent:start');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const start = await startMessage;
    expect(start.agentId).toBe('agent-1');
    expect(start.inboxSummary).toContain('Claimable unassigned tasks matching your role/capability:');
    expect(start.inboxSummary).toContain('engineer claimable task');
    expect(await store.getAgent('agent-1')).toMatchObject({
      machineId: 'machine-1',
      status: 'starting',
      autoStart: true,
    });
    ws.close();
  });

  it('does not auto-start manually stopped agents when daemon reports ready', async () => {
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    const messages: any[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    expect(messages.some((msg) => msg.type === 'agent:start')).toBe(false);
    expect((await store.getAgent('agent-1'))?.status).toBe('inactive');
    ws.close();
  });

  it('marks only disconnected machine agents inactive without clearing autoStart', async () => {
    const store = getStore();
    await store.upsertMachine({
      id: 'machine-2',
      hostname: 'other',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'running',
      autoStart: true,
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-2',
      name: 'other-bot',
      runtime: 'claude',
      status: 'running',
      autoStart: true,
      machineId: 'machine-2',
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: ['agent-1'],
      capabilities: [],
    });
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await store.getAgent('agent-1')).toMatchObject({ status: 'inactive', autoStart: true });
    expect(await store.getAgent('agent-2')).toMatchObject({ status: 'running', autoStart: true });
  });

  it('rebinds a persisted agent to a currently connected compatible machine on start', async () => {
    const store = getStore();
    await store.upsertMachine({
      id: 'stale-machine',
      hostname: 'old-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      status: 'offline',
      connectedAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: 'stale-machine',
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'fresh-machine',
      hostname: 'fresh-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const startMessage = waitForDaemonMessage(ws, 'agent:start');
    const res = await app.inject({ method: 'POST', url: '/api/agents/agent-1/start' });
    expect(res.statusCode).toBe(200);
    expect((await startMessage).agentId).toBe('agent-1');
    expect((await store.getAgent('agent-1'))?.machineId).toBe('fresh-machine');
    ws.close();
  });

  it('merges duplicate machines when daemon reports a stable machine id', async () => {
    const store = getStore();
    await store.upsertMachine({
      id: 'generated-machine-1',
      hostname: 'same-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      status: 'offline',
      connectedAt: new Date().toISOString(),
    });
    await store.upsertMachine({
      id: 'generated-machine-2',
      hostname: 'same-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      status: 'offline',
      connectedAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: 'generated-machine-1',
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'stable-machine',
      hostname: 'same-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: [],
    });

    const machines = await store.listMachines();
    expect(machines).toHaveLength(1);
    expect(machines[0].id).toBe('stable-machine');
    expect((await store.getAgent('agent-1'))?.machineId).toBe('stable-machine');
    ws.close();
  });

  it('reads agent workspace through daemon', async () => {
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: ['workspace:read'],
    });

    const readPromise = waitForWorkspaceRead(ws, {
      type: 'dir',
      path: '',
      children: [{ name: 'transcript.txt', type: 'file', size: 12 }],
    });
    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/workspace' });

    expect(res.statusCode).toBe(200);
    expect(await readPromise).toMatchObject({ agentId: 'agent-1', relPath: '' });
    expect(res.json()).toMatchObject({
      type: 'dir',
      children: [{ name: 'transcript.txt', type: 'file', size: 12 }],
    });
    ws.close();
  });

  it('reads agent workspace files through daemon', async () => {
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    const ws = await connectDaemon('dev-machine-key');
    await sendAndWait(ws, {
      type: 'ready',
      machineId: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0' },
      runningAgents: [],
      capabilities: ['workspace:read'],
    });

    const readPromise = waitForWorkspaceRead(ws, {
      type: 'file',
      path: 'transcript.txt',
      content: 'hello',
    });
    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/workspace?path=transcript.txt' });

    expect(res.statusCode).toBe(200);
    expect(await readPromise).toMatchObject({ agentId: 'agent-1', relPath: 'transcript.txt' });
    expect(res.json()).toMatchObject({ type: 'file', path: 'transcript.txt', content: 'hello' });
    ws.close();
  });

  it('rejects workspace path traversal before contacting daemon', async () => {
    await getStore().createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/workspace?path=../../../etc/passwd' });

    expect(res.statusCode).toBe(403);
  });
});
