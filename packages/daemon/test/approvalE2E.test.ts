import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../server/src/app.js';
import { getStore, resetStore } from '../../server/src/db.js';
import { executeAction, onApprovalResolved, pendingActions } from '../src/actions.js';
import { handleServerApprovalMessage } from '../src/approvalWatcher.js';

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
    machineId: 'e2e-machine',
    hostname: 'e2e-host',
    os: 'linux',
    daemonVersion: '0.1.0',
    runtimes: ['claude'],
    runtimeVersions: { claude: '1.0' },
    runningAgents: [],
    capabilities: [],
  }));
  await new Promise((resolve) => setTimeout(resolve, 60));

  const store = getStore();
  await store.createAgent({
    id: 'agent-e2e',
    name: 'agent-e2e',
    runtime: 'claude',
    status: 'running',
    machineId: 'e2e-machine',
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

describe('approval e2e', () => {
  it('covers risk_detected -> approval:resolved -> success', async () => {
    const swarmInit = await serverApp.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: {
        protocol_version: 'v1.0.0',
        channel_id: 'general',
        agents: [{ agent_id: 'agent-e2e', role: 'developer', allowed_tools: ['exec_cmd'] }],
      },
    });
    expect(swarmInit.statusCode).toBe(201);

    const action = await executeAction({
      action_id: 'act-e2e-1',
      agent_id: 'agent-e2e',
      tool: 'exec_cmd',
      params: { command: 'rm -rf /tmp/e2e-demo', timeoutSeconds: 1 },
    });

    expect(action).toMatchObject({
      action_id: 'act-e2e-1',
      status: 'risk_detected',
    });
    expect(action).toHaveProperty('approval_id');

    const approvalId = (action as { approval_id: string }).approval_id;
    const resumedPromise = new Promise<unknown>((resolve) => {
      const listener = async (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'approval:resolved' && msg.approval?.id === approvalId) {
          daemonWs.off('message', listener);
          resolve(await handleServerApprovalMessage(msg));
        }
      };
      daemonWs.on('message', listener);
    });

    const decision = await serverApp.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decision`,
      payload: { approved: true, reviewer: 'qa' },
    });
    expect(decision.statusCode).toBe(200);

    const resumed = await resumedPromise as { action_id?: string; approval_id?: string; status?: string; stdout?: string };
    expect(resumed).toMatchObject({
      action_id: 'act-e2e-1',
      approval_id: approvalId,
      status: 'success',
    });
    expect(resumed.stdout).toContain('[simulated] rm -rf /tmp/e2e-demo');
  });

  it('covers risk_detected -> approval:rejected -> returns rejected status', async () => {
    const swarmInit = await serverApp.inject({
      method: 'POST',
      url: '/api/v1/swarm/init',
      payload: {
        protocol_version: 'v1.0.0',
        channel_id: 'general',
        agents: [{ agent_id: 'agent-e2e', role: 'developer', allowed_tools: ['exec_cmd'] }],
      },
    });
    expect(swarmInit.statusCode).toBe(201);

    const action = await executeAction({
      action_id: 'act-e2e-2',
      agent_id: 'agent-e2e',
      tool: 'exec_cmd',
      params: { command: 'sudo rm -rf /etc', timeoutSeconds: 1 },
    });

    expect(action).toMatchObject({
      action_id: 'act-e2e-2',
      status: 'risk_detected',
    });
    expect(action).toHaveProperty('approval_id');

    const approvalId = (action as { approval_id: string }).approval_id;
    const resumedPromise = new Promise<unknown>((resolve) => {
      const listener = async (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'approval:resolved' && msg.approval?.id === approvalId) {
          daemonWs.off('message', listener);
          resolve(await handleServerApprovalMessage(msg));
        }
      };
      daemonWs.on('message', listener);
    });

    const decision = await serverApp.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decision`,
      payload: { approved: false, reviewer: 'qa', comment: 'too dangerous' },
    });
    expect(decision.statusCode).toBe(200);

    const resumed = await resumedPromise as { action_id?: string; approval_id?: string; status?: string };
    expect(resumed).toMatchObject({
      action_id: 'act-e2e-2',
      approval_id: approvalId,
      status: 'rejected',
    });
    expect(pendingActions.has(approvalId)).toBe(false);
  });

  it('bypasses approval for non-dangerous commands', async () => {
    const action = await executeAction({
      action_id: 'act-e2e-3',
      agent_id: 'agent-e2e',
      tool: 'exec_cmd',
      params: { command: 'echo safe command', timeoutSeconds: 1 },
    });

    expect(action).toMatchObject({
      action_id: 'act-e2e-3',
      status: 'success',
    });
    expect((action as { stdout?: string }).stdout).toContain('[simulated] echo safe command');
  });
});
