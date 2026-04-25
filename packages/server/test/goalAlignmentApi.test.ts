import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('goal alignment API', () => {
  it('starts alignment from chat, keeps it in the thread, and confirms goal tasks', async () => {
    const app = await buildApp();
    const pm = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'pm',
        runtime: 'codex',
        displayName: 'Product Manager',
        organization: { roles: ['Product Manager'], capabilities: ['requirements planning'] },
      },
    });
    const qa = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'qa',
        runtime: 'codex',
        displayName: 'QA',
        organization: { roles: ['QA'], capabilities: ['quality review'] },
      },
    });
    const message = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: '帮我做一个 Mac 全局语音输入法，从需求到技术方案都安排一下' },
    });

    const started = await app.inject({
      method: 'POST',
      url: `/api/messages/${message.json().id}/start-goal-alignment`,
      payload: { requesterName: 'user' },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      channelId: 'general',
      sourceMessageId: message.json().id,
      threadRootId: message.json().id,
      riskLevel: 'low',
    });
    expect(started.json().questions.length).toBeGreaterThan(0);
    expect(started.json().recommendedAgentIds).toContain(pm.json().id);
    expect(started.json().reviewerAgentIds).toContain(qa.json().id);
    const alignmentId = started.json().id;

    const thread = await app.inject({ method: 'GET', url: `/api/messages/${message.json().id}/thread` });
    expect(thread.json().replies.map((reply: { content: string }) => reply.content).join('\n')).toContain('Goal alignment started');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/goal-alignments/${alignmentId}`,
      payload: {
        answers: ['MVP should support push-to-talk and English/Chinese recognition.'],
        successCriteria: ['User can see an actionable MVP plan.'],
        status: 'awaiting_confirmation',
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().answers).toEqual(['MVP should support push-to-talk and English/Chinese recognition.']);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/goal-alignments/${alignmentId}/confirm`,
      payload: { requesterName: 'user' },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().goal).toMatchObject({ status: 'confirmed', objective: message.json().content });
    expect(confirmed.json().tasks).toHaveLength(2);
    expect(confirmed.json().tasks[0].context).toMatchObject({
      goalId: confirmed.json().goal.id,
      goalObjective: message.json().content,
      acceptanceCriteria: ['Scope, milestones, and handoff points are clear.'],
    });

    const read = await app.inject({ method: 'GET', url: `/api/goal-alignments/${alignmentId}` });
    expect(read.json()).toMatchObject({ status: 'confirmed', goalId: confirmed.json().goal.id });
    await app.close();
  });

  it('cancels and rejects invalid alignment operations', async () => {
    const app = await buildApp();
    const message = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Plan a production deploy with billing changes' },
    });
    const started = await app.inject({ method: 'POST', url: `/api/messages/${message.json().id}/start-goal-alignment`, payload: {} });
    expect(started.json().riskLevel).toBe('high');
    const cancelled = await app.inject({ method: 'POST', url: `/api/goal-alignments/${started.json().id}/cancel` });
    expect(cancelled.json().status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: `/api/goal-alignments/${started.json().id}/confirm`, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/goal-alignments?status=bad' })).statusCode).toBe(400);
    await app.close();
  });
});
