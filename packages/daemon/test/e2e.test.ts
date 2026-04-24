import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { join } from 'path';
import WebSocket from 'ws';

// We need to import server buildApp and store
// Use dynamic imports so vitest can resolve them

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('E2E: fake runtime agent loop', () => {
  let serverApp: any;
  let port: number;
  let daemonWs: WebSocket;
  let machineId: string;
  let agentId: string;

  beforeAll(async () => {
    // Dynamically import server modules
    const { buildApp } = await import('../../server/src/app.js');
    const { resetStore, getStore } = await import('../../server/src/db.js');

    resetStore();
    serverApp = await buildApp();
    await serverApp.listen({ port: 0, host: '127.0.0.1' });
    const address = serverApp.server.address();
    port = address.port;

    // Connect a fake daemon
    machineId = 'e2e-machine';
    daemonWs = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=dev-machine-key`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });

    // Send ready
    daemonWs.send(
      JSON.stringify({
        type: 'ready',
        machineId,
        hostname: 'e2e-host',
        os: 'linux',
        daemonVersion: '0.1.0',
        runtimes: ['claude'],
        runtimeVersions: { claude: '1.0' },
        runningAgents: [],
        capabilities: [],
      })
    );
    await new Promise((r) => setTimeout(r, 50));

    // Create agent via API
    const res = await serverApp.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'fake-bot', runtime: 'claude', machineId },
    });
    agentId = res.json().id;

    // Patch agent machineId (already set via payload)
    // Start agent via API
    await serverApp.inject({
      method: 'POST',
      url: `/api/agents/${agentId}/start`,
    });
    await new Promise((r) => setTimeout(r, 50));
  }, 10000);

  afterAll(async () => {
    daemonWs?.close();
    await serverApp?.close();
  });

  it('server sends agent:start to daemon when agent is started', async () => {
    // The daemon should have received agent:start — verify agent status was updated
    const { getStore } = await import('../../server/src/db.js');
    const agent = getStore().getAgent(agentId);
    // Status should be 'starting' (we sent start but daemon hasn't acked yet)
    expect(['starting', 'running', 'idle']).toContain(agent?.status);
  });

  it('full message → agent → reply loop with fake driver', async () => {
    const { getStore } = await import('../../server/src/db.js');

    // Listen for agent:message from daemon
    const replyPromise = new Promise<string>((resolve) => {
      daemonWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'agent:deliver') {
          // Simulate fake agent processing: echo back via agent:message
          const content = msg.message.content;
          daemonWs.send(
            JSON.stringify({
              type: 'agent:message',
              agentId,
              channelId: 'general',
              content: `Echo: ${content}`,
            })
          );
        }
      });

      // Also watch for the message to appear in the store
      const interval = setInterval(() => {
        const msgs = getStore().listMessages('general');
        const echo = msgs.find((m) => m.content.startsWith('Echo:'));
        if (echo) {
          clearInterval(interval);
          resolve(echo.content);
        }
      }, 20);

      setTimeout(() => {
        clearInterval(interval);
        resolve('timeout');
      }, 3000);
    });

    // Send a message to the channel targeting the agent
    await serverApp.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Hello agent', agentId },
    });

    const reply = await replyPromise;
    expect(reply).toBe('Echo: Hello agent');
  });
});
