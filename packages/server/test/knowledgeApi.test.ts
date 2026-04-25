import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('knowledge API', () => {
  it('creates, searches, reads, and updates knowledge entries', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      payload: {
        kind: 'decision',
        title: 'V1 test environment',
        summary: 'V1 uses the test Cloudflare instance.',
        body: 'Do not deploy V1 to production before acceptance.',
        tags: ['v1', 'cloudflare'],
        sourceRefs: ['goal:v1'],
      },
    });
    expect(created.statusCode).toBe(201);
    const entry = created.json();
    expect(entry).toMatchObject({ kind: 'decision', status: 'active', tags: ['v1', 'cloudflare'] });

    const searched = await app.inject({ method: 'GET', url: '/api/knowledge?query=test%20environment&kind=decision&tag=v1' });
    expect(searched.statusCode).toBe(200);
    expect(searched.json()).toContainEqual(expect.objectContaining({ entry: expect.objectContaining({ id: entry.id }) }));

    const read = await app.inject({ method: 'GET', url: `/api/knowledge/${entry.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().title).toBe('V1 test environment');

    const patched = await app.inject({ method: 'PATCH', url: `/api/knowledge/${entry.id}`, payload: { status: 'stale' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ status: 'stale' });
    await app.close();
  });

  it('requires source refs unless explicitly allowed', async () => {
    const app = await buildApp();
    const missing = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      payload: { kind: 'learning', title: 'No source', summary: 'Missing source.', body: 'No source refs.' },
    });
    expect(missing.statusCode).toBe(400);

    const manual = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      payload: { kind: 'learning', title: 'Manual note', summary: 'Manual source allowed.', body: 'Created by user.', allowNoSource: true },
    });
    expect(manual.statusCode).toBe(201);
    await app.close();
  });

  it('archives a goal with tasks and review evidence', async () => {
    const app = await buildApp();
    const store = getStore();
    const goal = await store.createGoal({
      id: 'goal-1',
      channelId: 'general',
      requesterName: 'user',
      objective: 'Ship knowledge layer',
      background: ['v1.5'],
      successCriteria: ['Knowledge is searchable'],
      constraints: [],
      assumptions: [],
      risks: [],
      status: 'completed',
    });
    await store.createTask({
      id: 'task-1',
      channelId: 'general',
      title: 'Implement knowledge API',
      status: 'done',
      creatorName: 'user',
      context: {
        goalId: goal.id,
        reviews: [{
          id: 'review-1',
          taskId: 'task-1',
          status: 'approved',
          evidence: ['pnpm verify passed'],
          checklist: [{ label: 'Knowledge is searchable', checked: true }],
          createdAt: '2026-04-25T00:00:00.000Z',
          updatedAt: '2026-04-25T00:00:00.000Z',
        }],
      },
    });

    const archived = await app.inject({ method: 'POST', url: '/api/goals/goal-1/archive' });
    expect(archived.statusCode).toBe(201);
    expect(archived.json()).toMatchObject({
      kind: 'project_archive',
      title: 'Archive: Ship knowledge layer',
      sourceRefs: expect.arrayContaining(['goal:goal-1', 'task:task-1', 'review:review-1']),
    });
    expect(archived.json().body).toContain('pnpm verify passed');
    await app.close();
  });
});
