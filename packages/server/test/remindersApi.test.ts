import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';
import { triggerDueReminders } from '../src/reminders.js';

beforeEach(async () => {
  await resetStore();
});

describe('reminders API', () => {
  it('creates and lists pending reminders for an agent', async () => {
    const app = await buildApp();
    const agent = await createAgent(app);

    const created = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/reminders`,
      payload: { channelId: 'general', message: 'hello later', triggerAt: '2026-04-25T12:00:00.000Z' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ agentId: agent.id, channelId: 'general', message: 'hello later', status: 'pending' });

    const listed = await app.inject({ method: 'GET', url: `/api/agents/${agent.id}/reminders` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    await app.close();
  });

  it('triggers due reminders and writes an agent channel message', async () => {
    const app = await buildApp();
    const agent = await createAgent(app);
    const reminder = await getStore().createReminder({
      id: 'rem-1',
      agentId: agent.id,
      channelId: 'general',
      message: 'time to report',
      triggerAt: '2026-04-25T00:00:00.000Z',
      status: 'pending',
    });

    expect(reminder.status).toBe('pending');
    expect(await triggerDueReminders(new Date('2026-04-25T00:00:01.000Z'))).toBe(1);
    expect((await getStore().getReminder('rem-1'))?.status).toBe('triggered');

    const messages = await getStore().listMessages('general');
    expect(messages[messages.length - 1]).toMatchObject({ agentId: agent.id, content: 'time to report' });
    await app.close();
  });

  it('cancels reminders so the scheduler no longer triggers them', async () => {
    const app = await buildApp();
    const agent = await createAgent(app);
    await getStore().createReminder({
      id: 'rem-1',
      agentId: agent.id,
      channelId: 'general',
      message: 'do not send',
      triggerAt: '2026-04-25T00:00:00.000Z',
      status: 'pending',
    });

    const cancelled = await app.inject({ method: 'PATCH', url: '/api/reminders/rem-1', payload: { status: 'cancelled' } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');
    expect(await triggerDueReminders(new Date('2026-04-25T00:00:01.000Z'))).toBe(0);
    expect(await getStore().listMessages('general')).toHaveLength(0);
    await app.close();
  });
});

async function createAgent(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'bot', runtime: 'claude' } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
