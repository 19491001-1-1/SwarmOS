import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const WEB_TOKEN = 'test-web-token';
const DAEMON_KEY = 'test-daemon-key';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${WEB_TOKEN}`, ...(extra ?? {}) };
}

describe('browser auth', () => {
  it('returns public hub version info', async () => {
    const res = await SELF.fetch('https://hub.test/api/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { component: string; version: string };
    expect(body.component).toBe('cloudflare-hub');
    expect(body.version).toBeTruthy();
  });

  it('rejects /api/* without token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels');
    expect(res.status).toBe(401);
  });

  it('rejects /api/* with wrong token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts /api/* with correct token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', { headers: authHeaders() });
    expect(res.status).toBe(200);
    const channels = (await res.json()) as Array<{ name: string }>;
    expect(channels.find((c) => c.name === 'general')).toBeTruthy();
  });

  it('allows OPTIONS preflight without token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
  });
});

describe('input validation', () => {
  it('returns 400 for invalid agent body', async () => {
    const res = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('creates agent with valid body', async () => {
    const res = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'a', runtime: 'claude' }),
    });
    expect(res.status).toBe(201);
    const agent = (await res.json()) as { id: string; name: string; status: string };
    expect(agent.name).toBe('a');
    expect(agent.status).toBe('inactive');
  });

  it('rejects empty message content', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'u', content: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects PATCH with empty body', async () => {
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'b', runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string };
    const res = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('daemon connection', () => {
  it('rejects missing daemon key', async () => {
    const res = await SELF.fetch('https://hub.test/daemon/connect', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects wrong daemon key', async () => {
    const res = await SELF.fetch('https://hub.test/daemon/connect?key=wrong', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts daemon with valid key and registers machine on ready', async () => {
    const res = await SELF.fetch(`https://hub.test/daemon/connect?key=${DAEMON_KEY}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    if (!ws) return;
    ws.accept();

    ws.send(
      JSON.stringify({
        type: 'ready',
        machineId: 'machine-test-1',
        hostname: 'host-1',
        os: 'darwin',
        daemonVersion: '0.1.0',
        runtimes: ['claude'],
        runtimeVersions: { claude: '1.0.0' },
        runningAgents: [],
        capabilities: [],
      }),
    );

    // Allow ready message processing
    await new Promise((r) => setTimeout(r, 80));

    const machinesRes = await SELF.fetch('https://hub.test/api/machines', { headers: authHeaders() });
    expect(machinesRes.status).toBe(200);
    const machines = (await machinesRes.json()) as Array<{ id: string; status: string }>;
    expect(machines.find((m) => m.id === 'machine-test-1' && m.status === 'online')).toBeTruthy();

    ws.close();
  });
});

describe('browser websocket auth', () => {
  it('rejects /ws without token', async () => {
    const res = await SELF.fetch('https://hub.test/ws', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(401);
  });

  it('accepts /ws with correct token', async () => {
    const res = await SELF.fetch(`https://hub.test/ws?token=${WEB_TOKEN}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});
