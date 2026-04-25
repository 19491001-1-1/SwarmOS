import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('search API', () => {
  it('returns matching messages with channelName', async () => {
    const app = await buildApp();
    const channel = await getStore().createChannel('ops', 'ops');
    await getStore().createMessage({ id: 'msg-1', channelId: channel.id, senderName: 'user', content: 'deploy keyword' });
    await getStore().createMessage({ id: 'msg-2', channelId: 'general', senderName: 'user', content: 'nothing here' });

    const res = await app.inject({ method: 'GET', url: '/api/search?q=keyword&limit=20' });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(1);
    expect(res.json().messages[0]).toMatchObject({ id: 'msg-1', channelName: 'ops' });
    await app.close();
  });

  it('returns an empty list for missing keywords', async () => {
    const app = await buildApp();
    await getStore().createMessage({ id: 'msg-1', channelId: 'general', senderName: 'user', content: 'hello' });
    const res = await app.inject({ method: 'GET', url: '/api/search?q=absent' });
    expect(res.json().messages).toEqual([]);
    await app.close();
  });
});
