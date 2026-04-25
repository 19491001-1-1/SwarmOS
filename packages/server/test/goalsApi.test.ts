import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('goal API', () => {
  it('creates, lists, reads, updates, and breaks down goals into contextual tasks', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/goals',
      payload: {
        channelId: 'general',
        requesterName: 'user',
        objective: 'Ship a Mac voice input MVP',
        background: ['User wants a global dictation tool'],
        successCriteria: ['MVP plan is actionable'],
        constraints: ['Keep scope small'],
        assumptions: ['macOS is primary'],
        risks: ['Speech permissions may be tricky'],
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      channelId: 'general',
      requesterName: 'user',
      objective: 'Ship a Mac voice input MVP',
      status: 'draft',
      successCriteria: ['MVP plan is actionable'],
    });
    const goalId = created.json().id;

    const listed = await app.inject({ method: 'GET', url: '/api/goals?channelId=general&status=draft' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/goals/${goalId}`,
      payload: { status: 'confirmed', risks: ['Need user approval for microphone permissions'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ status: 'confirmed', risks: ['Need user approval for microphone permissions'] });

    const breakdown = await app.inject({
      method: 'POST',
      url: `/api/goals/${goalId}/tasks`,
      payload: {
        creatorName: 'user',
        tasks: [
          {
            title: 'Draft product MVP',
            dependencies: ['Clarify target language'],
            acceptanceCriteria: ['C端/B端 scope is explicit'],
            artifacts: ['mvp.md'],
          },
          { title: 'Draft technical plan' },
        ],
      },
    });
    expect(breakdown.statusCode).toBe(201);
    expect(breakdown.json().tasks).toHaveLength(2);
    expect(breakdown.json().tasks[0].context).toMatchObject({
      goalId,
      goalObjective: 'Ship a Mac voice input MVP',
      acceptanceCriteria: ['C端/B端 scope is explicit'],
      dependencies: ['Clarify target language'],
      artifacts: ['mvp.md'],
    });
    expect(breakdown.json().tasks[1].context.acceptanceCriteria).toEqual(['MVP plan is actionable']);

    const read = await app.inject({ method: 'GET', url: `/api/goals/${goalId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().tasks.map((task: { title: string }) => task.title)).toEqual(['Draft product MVP', 'Draft technical plan']);
    await app.close();
  });

  it('creates a goal draft from a message', async () => {
    const app = await buildApp();
    const message = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Help me plan a food delivery app MVP' },
    });
    const goal = await app.inject({
      method: 'POST',
      url: `/api/messages/${message.json().id}/to-goal`,
      payload: { requesterName: 'user', successCriteria: ['Tasks are ready for agents'] },
    });
    expect(goal.statusCode).toBe(201);
    expect(goal.json()).toMatchObject({
      channelId: 'general',
      sourceMessageId: message.json().id,
      objective: 'Help me plan a food delivery app MVP',
      status: 'draft',
      successCriteria: ['Tasks are ready for agents'],
    });
    await app.close();
  });

  it('rejects invalid goal requests', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'POST', url: '/api/goals', payload: { objective: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/goals?status=blocked' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/goals/missing/tasks', payload: { tasks: [{ title: 'x' }] } })).statusCode).toBe(404);
    await app.close();
  });
});
