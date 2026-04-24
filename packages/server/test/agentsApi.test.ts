import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';

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

describe('GET /api/machines', () => {
  it('returns empty list initially', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/machines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    await app.close();
  });
});
