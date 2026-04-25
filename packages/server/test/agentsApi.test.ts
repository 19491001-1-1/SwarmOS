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
    const body = res.json();
    expect(body.component).toBe('server');
    expect(body.version).toBe(process.env.XOXIANG_VERSION || '0.6.0');
    expect(body.version).toBeTruthy();
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

  it('persists thread replies separately from channel messages', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'pm',
      displayName: '产品经理',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const root = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Root @产品经理' },
    });
    expect(root.statusCode).toBe(201);
    expect(root.json().mentions).toEqual([{ type: 'agent', id: 'agent-1', label: '产品经理' }]);

    const reply = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Thread reply', threadRootId: root.json().id },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ threadRootId: root.json().id, content: 'Thread reply' });

    const listed = await app.inject({ method: 'GET', url: '/api/channels/general/messages' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ id: root.json().id, replyCount: 1 });

    const thread = await app.inject({ method: 'GET', url: `/api/messages/${root.json().id}/thread` });
    expect(thread.statusCode).toBe(200);
    expect(thread.json().root.id).toBe(root.json().id);
    expect(thread.json().replies).toHaveLength(1);
    expect(thread.json().replies[0].id).toBe(reply.json().id);
    await app.close();
  });

  it('rejects missing or cross-channel thread roots', async () => {
    const app = await buildApp();
    await getStore().createChannel('other', 'other');
    const root = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Root' },
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'reply', threadRootId: 'missing' },
    });
    expect(missing.statusCode).toBe(404);

    const cross = await app.inject({
      method: 'POST',
      url: '/api/channels/other/messages',
      payload: { senderName: 'user', content: 'reply', threadRootId: root.json().id },
    });
    expect(cross.statusCode).toBe(400);
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
    expect(agent.autoStart).toBe(false);
    await app.close();
  });

  it('creates an agent with organization profile', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'qa-agent',
        runtime: 'claude',
        organization: { department: 'delivery', roles: ['QA'], capabilities: ['quality gate'], availability: 'available' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().organization).toMatchObject({ department: 'delivery', roles: ['QA'], capabilities: ['quality gate'] });
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
    const fetched = await app.inject({ method: 'GET', url: `/api/agents/${agentId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().displayName).toBe('New');
    await app.close();
  });

  it('updates organization profile', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'a', runtime: 'claude' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.json().id}`,
      payload: { organization: { department: 'product', roles: ['PM'], capabilities: ['requirements'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organization.roles).toEqual(['PM']);
    await app.close();
  });
});

describe('agent direct messages API', () => {
  it('creates a DM and lists it in threads and conversation', async () => {
    const app = await buildApp();
    await getStore().createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/dms/user',
      payload: { content: 'private hello' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ fromAgentId: 'user', toAgentId: 'agent-1', content: 'private hello' });

    const threads = await app.inject({ method: 'GET', url: '/api/agents/agent-1/dms' });
    expect(threads.statusCode).toBe(200);
    expect(threads.json()[0].otherAgentId).toBe('user');

    const conversation = await app.inject({ method: 'GET', url: '/api/agents/agent-1/dms/user' });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toHaveLength(1);
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

describe('agent internal API', () => {
  async function createInternalAgent() {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      displayName: 'Bot',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    const token = (await store.getOrCreateAgentToken('agent-1')).token;
    const headers = { Authorization: `Bearer ${token}`, 'X-Agent-Id': 'agent-1' };
    return { app, store, headers };
  }

  it('rejects missing and invalid agent tokens', async () => {
    const { app } = await createInternalAgent();

    const missing = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/auth/whoami' });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: '/internal/agent/agent-1/auth/whoami',
      headers: { Authorization: 'Bearer wrong', 'X-Agent-Id': 'agent-1' },
    });
    expect(wrong.statusCode).toBe(401);
    await app.close();
  });

  it('returns whoami and server info for a valid token', async () => {
    const { app, headers } = await createInternalAgent();
    const whoami = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/auth/whoami', headers });
    expect(whoami.statusCode).toBe(200);
    expect(whoami.json().agent.name).toBe('bot');

    const info = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/server/info', headers });
    expect(info.statusCode).toBe(200);
    expect(info.json().channels[0].id).toBe('general');
    expect(info.json().version.component).toBe('server');
    await app.close();
  });

  it('resolves agent ids from display names and role descriptions', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.createAgent({
      id: 'agent-111',
      name: 'pm-111',
      displayName: '产品经理',
      description: 'Product manager for task triage',
      organization: { department: 'product', roles: ['PM'], capabilities: ['requirements'] },
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    const displayName = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86', headers });
    expect(displayName.statusCode).toBe(200);
    expect(displayName.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'exact_display_name' });

    const roleHint = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=task%20triage', headers });
    expect(roleHint.statusCode).toBe(200);
    expect(roleHint.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'description_hint' });

    const capabilityHint = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=requirements', headers });
    expect(capabilityHint.statusCode).toBe(200);
    expect(capabilityHint.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'description_hint' });
    await app.close();
  });

  it('sends and reads channel messages', async () => {
    const { app, headers } = await createInternalAgent();
    const sent = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/messages/send',
      headers,
      payload: { channel: 'general', content: 'hello from cli' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ channelId: 'general', agentId: 'agent-1', senderName: 'Bot', content: 'hello from cli' });

    const read = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/messages/read?channel=general&limit=5', headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().at(-1).content).toBe('hello from cli');
    await app.close();
  });

  it('sends direct messages and delegates through existing logic', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.createAgent({
      id: 'agent-2',
      name: 'target',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    const dm = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/dms/send',
      headers,
      payload: { to: 'target', content: 'private note' },
    });
    expect(dm.statusCode).toBe(201);
    expect(dm.json()).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'private note' });

    const delegation = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/delegate',
      headers,
      payload: { to: 'target', content: 'please handle this', startIfInactive: false },
    });
    expect(delegation.statusCode).toBe(201);
    expect(delegation.json()).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', status: 'queued' });
    await app.close();
  });

  it('lists, reads, and updates assigned tasks', async () => {
    const { app, store, headers } = await createInternalAgent();
    const assigned = await store.createTask({
      id: 'task-1',
      channelId: 'general',
      title: 'agent task',
      status: 'todo',
      creatorName: 'user',
      assigneeId: 'agent-1',
      context: { goal: 'complete assigned task' },
    });
    await store.createAgent({
      id: 'agent-2',
      name: 'target',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    await store.createTask({
      id: 'task-2',
      channelId: 'general',
      title: 'someone else task',
      status: 'todo',
      creatorName: 'user',
      assigneeId: 'agent-2',
    });

    const listed = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].id).toBe(assigned.id);

    const read = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks/task-1', headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().title).toBe('agent task');
    expect(read.json().context.goal).toBe('complete assigned task');

    const forbidden = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks/task-2', headers });
    expect(forbidden.statusCode).toBe(403);

    const updated = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-1/update',
      headers,
      payload: { status: 'in_progress' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe('in_progress');

    const handedOff = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-1/handoff',
      headers,
      payload: { to: 'target', notes: 'analysis done', nextStep: 'write tests' },
    });
    expect(handedOff.statusCode).toBe(200);
    expect(handedOff.json().assigneeId).toBe('agent-2');
    expect(handedOff.json().context).toMatchObject({
      goal: 'complete assigned task',
      previousAgentId: 'agent-1',
      handoffNotes: ['from Bot: analysis done\nnext: write tests'],
    });
    await app.close();
  });

  it('returns inbox items and records claim/progress/block/escalation events', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.updateAgent('agent-1', { organization: { roles: ['Engineer'], capabilities: ['coding'] } });
    await store.createTask({
      id: 'task-claim',
      channelId: 'general',
      title: 'coding task for agent',
      status: 'todo',
      creatorName: 'user',
      context: { goal: 'coding implementation' },
    });

    const inbox = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/inbox', headers });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toContainEqual(expect.objectContaining({ kind: 'claimable_task', taskId: 'task-claim' }));

    const claimed = await app.inject({ method: 'POST', url: '/internal/agent/agent-1/tasks/task-claim/claim', headers });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ assigneeId: 'agent-1', status: 'in_progress', context: { claimedByAgentId: 'agent-1' } });
    expect(claimed.json().context.progressEvents.at(-1)).toMatchObject({ type: 'claimed', agentId: 'agent-1' });

    const progress = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/progress',
      headers,
      payload: { detail: 'implemented first slice' },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().context.progressEvents.at(-1)).toMatchObject({ type: 'heartbeat', detail: 'implemented first slice' });

    const blocked = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/block',
      headers,
      payload: { reason: 'missing API token', needs: 'user provides token' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().context).toMatchObject({ blockedReason: 'missing API token', blockedNeeds: 'user provides token' });

    const escalated = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/escalate',
      headers,
      payload: { reason: 'blocked after retry' },
    });
    expect(escalated.statusCode).toBe(200);
    expect(escalated.json().context).toMatchObject({ escalatedReason: 'blocked after retry' });
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
