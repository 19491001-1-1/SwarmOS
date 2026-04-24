import WebSocket from 'ws';
import os from 'os';
import { join } from 'path';
import type { DaemonToServer, ServerToDaemon } from '@mini-slock/shared';
import { ServerToDaemonSchema } from '@mini-slock/shared';
import { detectRuntimes } from './runtimeDetector.js';
import { AgentProcessManager } from './agentProcessManager.js';
import { getMachineId } from './machineIdentity.js';

const DAEMON_VERSION = '0.1.0';

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
    const workspaceBase = options.workspaceBase ?? join(os.homedir(), '.mini-slock', 'workspaces');
    this.processManager = new AgentProcessManager(
      workspaceBase,
      (agentId, channelId, content) => this.sendMessage({ type: 'agent:message', agentId, channelId, content }),
      (agentId, status) => this.sendMessage({ type: 'agent:status', agentId, status: status as any })
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
      runningAgents: [],
      capabilities: ['agent:start', 'agent:stop', 'agent:deliver'],
    });
  }

  private handleMessage(msg: ServerToDaemon): void {
    if (msg.type === 'ping') {
      this.sendMessage({ type: 'pong' });
      return;
    }

    if (msg.type === 'agent:start') {
      const channelId = msg.wakeMessage?.channelId ?? 'general';
      this.processManager.startAgent(msg.agentId, msg.config, channelId).then(() => {
        this.sendMessage({ type: 'agent:status', agentId: msg.agentId, status: 'running', launchId: msg.launchId });
        if (msg.wakeMessage) {
          this.processManager.deliverMessage(msg.agentId, msg.wakeMessage);
        }
      });
      return;
    }

    if (msg.type === 'agent:stop') {
      this.processManager.stopAgent(msg.agentId);
      return;
    }

    if (msg.type === 'agent:deliver') {
      const doDeliver = async () => {
        // Auto-recover agent if daemon restarted and lost the entry
        if (!this.processManager.isRunning(msg.agentId) && msg.config) {
          console.log(`[daemon] auto-recovering agent ${msg.agentId} (${msg.config.runtime})`);
          await this.processManager.startAgent(
            msg.agentId,
            msg.config,
            msg.channelId ?? msg.message.channelId
          );
        }
        await this.processManager.deliverMessage(msg.agentId, msg.message);
        this.sendMessage({ type: 'agent:deliver:ack', agentId: msg.agentId, seq: msg.seq });
      };
      doDeliver().catch((err) => {
        console.error('[daemon] deliver error:', err.message);
        this.sendMessage({ type: 'agent:status', agentId: msg.agentId, status: 'error' });
      });
      return;
    }
  }

  private sendMessage(msg: DaemonToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
