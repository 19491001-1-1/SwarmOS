import WebSocket from 'ws';
import os from 'os';
import { join } from 'path';
import type { AgentActivity, DaemonToServer, ServerToDaemon } from '@crewden/shared';
import { APP_VERSION, ServerToDaemonSchema } from '@crewden/shared';
import { detectRuntimes } from './runtimeDetector.js';
import { AgentProcessManager } from './agentProcessManager.js';
import { getMachineId } from './machineIdentity.js';

export const DAEMON_VERSION = process.env.CREWDEN_VERSION?.trim() || APP_VERSION;

export type DaemonClientOptions = {
  serverUrl: string;
  apiKey: string;
  workspaceBase?: string;
};

export class DaemonClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private options: DaemonClientOptions;
  private processManager: AgentProcessManager;

  constructor(options: DaemonClientOptions) {
    this.options = options;
    const workspaceBase = options.workspaceBase ?? process.env.CREWDEN_AGENTS_DIR ?? join(os.homedir(), '.crewden', 'agents');
    this.processManager = new AgentProcessManager(
      workspaceBase,
      (agentId, channelId, content, inReplyToMessageId) => this.sendMessage({ type: 'agent:message', agentId, channelId, content, inReplyToMessageId }),
      (agentId, status) => this.sendMessage({ type: 'agent:status', agentId, status: status as any }),
      (agentId, activityType, detail) => this.sendActivity(agentId, activityType, detail),
      (fromAgentId, toAgentId, content) => this.sendMessage({ type: 'agent:dm', fromAgentId, toAgentId, content }),
      (fromAgentId, toAgentId, content, startIfInactive) => this.sendMessage({ type: 'agent:delegate', fromAgentId, toAgentId, content, startIfInactive }),
      (agentId, title, channelId, assigneeId) => this.sendMessage({ type: 'agent:create_task', agentId, title, channelId, assigneeId }),
      (agentId, taskId, status) => this.sendMessage({ type: 'agent:update_task', agentId, taskId, status }),
      (agentId, message, triggerAt, channelId) => this.sendMessage({ type: 'agent:set_reminder', agentId, channelId, message, triggerAt }),
      (agentId, reminderId) => this.sendMessage({ type: 'agent:cancel_reminder', agentId, reminderId }),
      (agentId, sessionId) => this.sendMessage({ type: 'agent:session', agentId, sessionId }),
      options.serverUrl
    );
  }

  private getWsUrl(): string {
    const url = this.options.serverUrl
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://');
    return `${url}/daemon/connect?key=${this.options.apiKey}`;
  }

  connect(): void {
    const wsUrl = this.getWsUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', async () => {
      console.log(`[daemon] Connected to ${wsUrl}`);
      this.reconnectDelay = 1000;
      await this.sendReady();
    });

    this.ws.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const parsed = ServerToDaemonSchema.safeParse(data);
      if (!parsed.success) return;

      this.handleMessage(parsed.data);
    });

    this.ws.on('close', () => {
      console.log('[daemon] Disconnected');
      this.ws = null;
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[daemon] WebSocket error:', err.message);
    });
  }

  private async sendReady(): Promise<void> {
    const runtimes = await detectRuntimes();
    const runtimeIds = runtimes.map((r) => r.id);
    const runtimeVersions: Record<string, string> = {};
    for (const r of runtimes) runtimeVersions[r.id] = r.version;

    this.sendMessage({
      type: 'ready',
      machineId: await getMachineId(),
      hostname: os.hostname(),
      os: process.platform,
      daemonVersion: DAEMON_VERSION,
      runtimes: runtimeIds,
      runtimeVersions,
      runningAgents: this.processManager.listRunningAgentIds(),
      capabilities: ['agent:start', 'agent:stop', 'agent:deliver', 'workspace:read', 'reminders'],
    });
  }

  private handleMessage(msg: ServerToDaemon): void {
    if (msg.type === 'ping') {
      this.sendMessage({ type: 'pong' });
      return;
    }

    if (msg.type === 'agent:start') {
      const channelId = msg.wakeMessage?.channelId ?? 'general';
      this.processManager.startAgent(msg.agentId, msg.config, channelId, msg.wakeMessage).then(() => {
        this.sendMessage({ type: 'agent:status', agentId: msg.agentId, status: 'running', launchId: msg.launchId });
      });
      return;
    }

    if (msg.type === 'agent:stop') {
      this.processManager.stopAgent(msg.agentId);
      return;
    }

    if (msg.type === 'agent:deliver') {
      const doDeliver = async () => {
        await this.processManager.deliverMessage(msg.agentId, msg.message, msg.config, msg.channelId);
        this.sendMessage({ type: 'agent:deliver:ack', agentId: msg.agentId, seq: msg.seq });
      };
      doDeliver().catch((err) => {
        console.error('[daemon] deliver error:', err.message);
        this.sendMessage({ type: 'agent:status', agentId: msg.agentId, status: 'error' });
      });
      return;
    }

    if (msg.type === 'workspace:read') {
      this.processManager.readWorkspace(msg.agentId, msg.relPath)
        .then((result) => this.sendMessage({ type: 'workspace:result', requestId: msg.requestId, result }))
        .catch((err) => {
          this.sendMessage({
            type: 'workspace:result',
            requestId: msg.requestId,
            result: { type: 'error', error: err instanceof Error ? err.message : 'Failed to read workspace', status: 500 },
          });
        });
      return;
    }
  }

  private sendMessage(msg: DaemonToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendActivity(agentId: string, activityType: AgentActivity['type'], detail?: string): void {
    this.sendMessage({ type: 'agent:activity', agentId, activityType, detail });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
