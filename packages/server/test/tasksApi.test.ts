import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('task API', () => {
  it('creates, lists, updates, and deletes tasks', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'ship task board',
        creatorName: 'user',
        context: { goal: 'ship board', acceptanceCriteria: ['tasks persist context'] },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ channelId: 'general', title: 'ship task board', status: 'todo' });
    expect(created.json().context.goal).toBe('ship board');
    const taskId = created.json().id;

    const listed = await app.inject({ method: 'GET', url: '/api/tasks?channelId=general' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'in_review', context: { goal: 'ship board', handoffNotes: ['ready for review'] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('in_review');
    expect(patched.json().context.handoffNotes).toEqual(['ready for review']);

    const filtered = await app.inject({ method: 'GET', url: '/api/tasks?status=in_review' });
    expect(filtered.json()).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
    expect(deleted.statusCode).toBe(204);
    expect(await getStore().listTasks()).toHaveLength(0);
    await app.close();
  });

  it('creates a task from a message', async () => {
    const app = await buildApp();
    const message = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Turn this message into a task' },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/messages/${message.json().id}/to-task`,
      payload: { creatorName: 'user', context: { goal: 'convert message into work' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      channelId: 'general',
      messageId: message.json().id,
      title: 'Turn this message into a task',
    });
    expect(created.json().context).toMatchObject({
      goal: 'convert message into work',
      sourceMessageIds: [message.json().id],
    });
    await app.close();
  });

  it('rejects invalid task bodies', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/tasks/nope', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tasks?status=blocked' })).statusCode).toBe(400);
    await app.close();
  });
});
