import WebSocket from 'ws';
import os from 'os';
import { join } from 'path';
import type { AgentActivity, DaemonToServer, ServerToDaemon } from '@crewden/shared';
import { APP_VERSION, ServerToDaemonSchema } from '@crewden/shared';
import { handleServerApprovalMessage } from './approvalWatcher.js';
import { detectRuntimes } from './runtimeDetector.js';
import { AgentProcessManager } from './agentProcessManager.js';
import { getMachineId } from './machineIdentity.js';
import { lockManager } from './locks.js';
import { executeAction } from './actions.js';

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

    // Forward lock state changes to the server
    lockManager.onChange((path, state, agentId) => {
      this.sendMessage({
        type: 'lock:update',
        path,
        state,
        agentId,
        since: new Date().toISOString(),
      });
    });
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
      capabilities: ['agent:start', 'agent:stop', 'agent:deliver', 'workspace:read', 'reminders', 'action:execute'],
    });
  }

  private handleMessage(msg: ServerToDaemon): void {
    if (msg.type === 'ping') {
      this.sendMessage({ type: 'pong' });
      return;
    }

    if (msg.type === 'approval:resolved') {
      void (async () => {
        const result = await handleServerApprovalMessage(msg);
        const approval = msg.approval;
        if (!result || !approval?.agentId) return;
        // Send back action execution result after approval decision
        const r = result as any;
        const status = r.status ?? (approval.status === 'approved' ? 'approved' : 'rejected');
        this.sendRawMessage({
          type: 'daemon:action:update',
          agentId: approval.agentId,
          action: {
            action_id: r.action_id ?? approval.id,
            status: status,
            stdout: r.stdout,
            stderr: r.stderr,
            error_type: r.error_type,
            timestamp: new Date().toISOString(),
            approval_id: approval.id,
          },
        });
      })().catch((err) => {
        console.error('[daemon] approval resume error:', err instanceof Error ? err.message : String(err));
      });
      return;
    }

    if (msg.type === 'agent:start') {
      const channelId = msg.wakeMessage?.channelId ?? 'general';
      this.processManager.startAgent(msg.agentId, msg.config, channelId, msg.wakeMessage, msg.inboxSummary).then(() => {
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
        await this.processManager.deliverMessage(msg.agentId, msg.message, msg.config, msg.channelId, msg.inboxSummary);
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

    if (msg.type === 'action:execute') {
      // Report "running" state before execution
      this.sendRawMessage({
        type: 'daemon:action:update',
        agentId: msg.agentId,
        action: {
          action_id: msg.action.action_id,
          status: 'running',
          timestamp: new Date().toISOString(),
        },
      });
      this.processManager.emitActivity(msg.agentId, 'working', `action:${msg.action.tool} executing (${msg.action.action_id})`);
      executeAction(msg.action).then((result: any) => {
        this.sendRawMessage({
          type: 'daemon:action:update',
          agentId: msg.agentId,
          action: {
            action_id: result.action_id,
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            error_type: result.error_type,
            timestamp: result.timestamp,
            lock_owner: result.lock_owner,
            approval_id: result.approval_id,
          },
        });
        this.processManager.emitActivity(msg.agentId, 'output', `action:${msg.action.tool} ${result.status} (${msg.action.action_id})`);
      }).catch((err: any) => {
        this.sendRawMessage({
          type: 'daemon:action:update',
          agentId: msg.agentId,
          action: {
            action_id: msg.action.action_id,
            status: 'error',
            error_type: 'DaemonError',
            stderr: err instanceof Error ? err.message : 'Unknown daemon error',
            timestamp: new Date().toISOString(),
          },
        });
        this.processManager.emitActivity(msg.agentId, 'error', `action:${msg.action.tool} failed (${msg.action.action_id})`);
      });
      return;
    }
  }

  private sendMessage(msg: DaemonToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** send a raw JSON message that is not strictly typed as DaemonToServer */
  private sendRawMessage(msg: Record<string, unknown>): void {
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
