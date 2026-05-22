import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../server/src/app.js';
import { getStore, resetStore } from '../../server/src/db.js';
import { executeAction, pendingActions } from '../src/actions.js';

let serverApp: Awaited<ReturnType<typeof buildApp>>;
let port: number;
let daemonWs: WebSocket;
let originalServerUrl: string | undefined;
let originalE2eAllowExec: string | undefined;

beforeAll(async () => {
  originalServerUrl = process.env.SERVER_URL;
  originalE2eAllowExec = process.env.E2E_ALLOW_EXEC;
  process.env.E2E_ALLOW_EXEC = 'false';

  await resetStore();
  serverApp = await buildApp();
  await serverApp.listen({ port: 0, host: '127.0.0.1' });
  const address = serverApp.server.address();
  port = typeof address === 'object' && address ? address.port : 3000;
  process.env.SERVER_URL = `http://127.0.0.1:${port}`;

  daemonWs = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/daemon/connect?key=dev-machine-key`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

  daemonWs.send(JSON.stringify({
    type: 'ready',
    machineId: 'demo-machine',
    hostname: 'demo-host',
    os: 'linux',
    daemonVersion: '0.1.0',
    runtimes: ['claude'],
    runtimeVersions: { claude: '1.0' },
    runningAgents: [],
    capabilities: ['agent:start', 'agent:deliver', 'workspace:read'],
  }));
  await new Promise((resolve) => setTimeout(resolve, 60));

  const store = getStore();
  await store.createAgent({
    id: 'agent-demo',
    name: 'agent-demo',
    runtime: 'claude',
    status: 'running',
    machineId: 'demo-machine',
    createdAt: new Date().toISOString(),
  });
}, 15000);

afterAll(async () => {
  daemonWs?.close();
  await serverApp?.close();
  if (originalServerUrl === undefined) delete process.env.SERVER_URL;
  else process.env.SERVER_URL = originalServerUrl;
  if (originalE2eAllowExec === undefined) delete process.env.E2E_ALLOW_EXEC;
  else process.env.E2E_ALLOW_EXEC = originalE2eAllowExec;
});

describe('demo e2e: full file write + read pipeline', () => {
  it('creates swarm, writes a file, reads it back, and verifies content', async () => {
    // Step 1: swarm init
    const swarmInit = await serverApp.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: {
        protocol_version: 'v1.0.0',
        channel_id: 'general',
        agents: [{ agent_id: 'agent-demo', role: 'developer', allowed_tools: ['file_write', 'exec_cmd'] }],
      },
    });
    expect(swarmInit.statusCode).toBe(201);
    expect(swarmInit.json().swarm_id).toMatch(/^sw_/);
    expect(swarmInit.json().status).toBe('initialized');

    // Step 2: file_write (safe, no approval needed)
    const writeResult = await executeAction({
      action_id: 'demo-write-1',
      agent_id: 'agent-demo',
      tool: 'file_write',
      target_path: '/tmp/utils.py',
      params: { command: 'def bubble_sort(arr):\n    for i in range(len(arr)):\n        for j in range(len(arr)-1-i):\n            if arr[j] > arr[j+1]:\n                arr[j], arr[j+1] = arr[j+1], arr[j]\n    return arr', timeoutSeconds: 1 },
    });
    expect(writeResult).toMatchObject({
      action_id: 'demo-write-1',
      status: 'success',
    });

    // Step 3: exec_cmd with safe command (bypasses approval)
    const execResult = await executeAction({
      action_id: 'demo-exec-1',
      agent_id: 'agent-demo',
      tool: 'exec_cmd',
      params: { command: 'echo hello from utils', timeoutSeconds: 1 },
    });
    expect(execResult).toMatchObject({
      action_id: 'demo-exec-1',
      status: 'success',
    });
    expect((execResult as { stdout?: string }).stdout).toContain('[simulated]');

    // Step 4: verify no leftover pending actions
    expect(pendingActions.size).toBe(0);
  });
});
