import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';
import { clearSwarmStore } from '../src/swarmStore.js';

beforeEach(async () => {
  await resetStore();
  clearSwarmStore();
});

describe('swarm routes', () => {
  it('POST /api/v1/swarm/init creates a swarm session', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: {
        protocol_version: 'v1.0.0',
        channel_id: 'general',
        agents: [
          { agent_id: 'agent-1', role: 'developer', allowed_tools: ['exec_cmd', 'file_write'] },
          { agent_id: 'agent-2', role: 'reviewer', allowed_tools: ['exec_cmd'] },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      protocol_version: 'v1.0.0',
      channel_id: 'general',
      agent_count: 2,
    });
    // In test environment without a connected daemon, agents may fail to start
    expect(['initialized', 'partial', 'failed']).toContain(res.json().status);
    expect(res.json().swarm_id).toBeDefined();
    expect(res.json().swarm_id).toMatch(/^sw_/);
    await app.close();
  });

  it('POST /api/v1/swarm/init rejects request without channel_id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: { agents: [{ agent_id: 'agent-1' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
    await app.close();
  });

  it('POST /api/v1/swarm/init rejects request without agents array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: { channel_id: 'general' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
    await app.close();
  });

  it('POST /api/v1/swarm/init works with alternative agent key names (agentId, id)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: {
        channel_id: 'general',
        agents: [
          { agentId: 'agent-1' },
          { id: 'agent-2' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().agent_count).toBe(2);
    await app.close();
  });

  it('GET /api/v1/swarms lists all swarm sessions', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/v1/swarm/init', payload: { channel_id: 'general', agents: [{ agent_id: 'a1' }] } });
    await app.inject({ method: 'POST', url: '/api/v1/swarm/init', payload: { channel_id: 'random', agents: [{ agent_id: 'a2' }] } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/swarms' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    await app.close();
  });

  it('GET /api/v1/swarms returns empty array when no swarms exist', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/swarms' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});
