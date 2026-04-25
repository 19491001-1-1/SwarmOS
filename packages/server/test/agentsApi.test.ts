import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore, getStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('GET /api/channels', () => {
  it('returns default general channel', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('general');
    await app.close();
  });
});

describe('GET /api/version', () => {
  it('returns server version info', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ component: 'server', version: '0.1.0' });
    await app.close();
  });
});

describe('POST /api/channels/:id/messages', () => {
  it('creates a message', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Hello' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json();
    expect(msg.content).toBe('Hello');
    expect(msg.channelId).toBe('general');
    await app.close();
  });

  it('returns 404 for unknown channel', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/nonexistent/messages',
      payload: { senderName: 'user', content: 'Hello' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 for empty content', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for missing senderName', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/agents', () => {
  it('creates an agent', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'my-agent', runtime: 'claude' },
    });
    expect(res.statusCode).toBe(201);
    const agent = res.json();
    expect(agent.name).toBe('my-agent');
    expect(agent.runtime).toBe('claude');
    expect(agent.status).toBe('inactive');
    await app.close();
  });

  it('returns 400 without required fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'no-runtime' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for invalid runtime', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'gpt4' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /api/agents/:id', () => {
  it('returns 400 when no fields provided', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'claude' },
    });
    const agentId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agentId}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('updates a single field', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'claude' },
    });
    const agentId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agentId}`,
      payload: { displayName: 'New' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe('New');
    await app.close();
  });
});

describe('GET /api/agents', () => {
  it('lists agents', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'agent-1', runtime: 'gemini' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await app.close();
  });
});

describe('GET /api/agents/:id/activities', () => {
  it('returns recent activities for an agent newest first', async () => {
    const app = await buildApp();
    const store = getStore();
    const agent = await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    await store.createAgentActivity({ id: 'activity-1', agentId: agent.id, type: 'working', detail: 'Message received' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.createAgentActivity({ id: 'activity-2', agentId: agent.id, type: 'idle' });

    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/activities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('activity-2');
    expect(body[1].detail).toBe('Message received');
    await app.close();
  });

  it('keeps at most 500 activities per agent and API returns recent 200', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    for (let i = 0; i < 501; i += 1) {
      await store.createAgentActivity({ id: `activity-${i}`, agentId: 'agent-1', type: 'output', detail: `line ${i}` });
    }

    expect(await store.listAgentActivities('agent-1', 1000)).toHaveLength(500);
    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/activities' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(200);
    await app.close();
  });
});

describe('GET /api/machines', () => {
  it('returns empty list initially', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/machines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    await app.close();
  });
});
