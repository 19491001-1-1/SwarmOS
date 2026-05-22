import { appendFile, chmod, mkdir, writeFile } from 'fs/promises';
import { delimiter, dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import type { AgentRuntimeConfig, AgentDelivery, AgentActivity, WorkspaceEntry, WorkspaceError, TaskStatus } from '@crewden/shared';
import type { AgentSpawnContext, RuntimeDriver } from './drivers/types.js';
import { claudeDriver } from './drivers/claude.js';
import { codexDriver } from './drivers/codex.js';
import { geminiDriver } from './drivers/gemini.js';
import { ensureAgentWorkspace, readAgentWorkspace } from './workspace/agentWorkspace.js';
import { callInternalApi } from './internalAgentApi.js';

const DRIVERS: Record<string, RuntimeDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  gemini: geminiDriver,
};

const MAX_TRANSIENT_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 10;

function buildAgentCliWrapper(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageDir = dirname(moduleDir);
  const distCli = moduleDir.endsWith(`${sep}src`)
    ? join(packageDir, 'dist', 'agentCli.js')
    : join(moduleDir, 'agentCli.js');
  return [
    '#!/usr/bin/env sh',
    `CLI=${shQuote(distCli)}`,
    'if [ ! -f "$CLI" ]; then',
    '  echo "crewden CLI is not built. Run: pnpm --filter @crewden/daemon build" >&2',
    '  exit 127',
    'fi',
    'exec node "$CLI" "$@"',
    '',
  ].join('\n');
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toInboxSummaryDelivery(agentId: string): AgentDelivery {
  return {
    id: `inbox:${agentId}:${Date.now()}`,
    channelId: `inbox:${agentId}`,
    channelName: 'Task inbox',
    senderName: 'task-board',
    content: 'Agent wake requested. Review the current task inbox summary before choosing your next action.',
    createdAt: new Date().toISOString(),
  };
}

export type AgentMessageCallback = (agentId: string, channelId: string, content: string, inReplyToMessageId?: string) => void;
export type AgentStatusCallback = (agentId: string, status: string) => void;
export type AgentActivityCallback = (agentId: string, type: AgentActivity['type'], detail?: string) => void;
export type AgentDmCallback = (fromAgentId: string, toAgentId: string, content: string) => void;
export type AgentDelegateCallback = (fromAgentId: string, toAgentId: string, content: string, startIfInactive?: boolean) => void;
export type AgentCreateTaskCallback = (agentId: string, title: string, channelId?: string, assigneeId?: string) => void;
export type AgentUpdateTaskCallback = (agentId: string, taskId: string, status: TaskStatus) => void;
export type AgentSetReminderCallback = (agentId: string, message: string, triggerAt: string, channelId?: string) => void;
export type AgentCancelReminderCallback = (agentId: string, reminderId: string) => void;
export type AgentSessionCallback = (agentId: string, sessionId: string) => void;

interface AgentEntry {
  agentId: string;
  channelId: string;
  registered: boolean;
  processStatus: 'starting' | 'active' | 'idle' | 'exited' | 'error';
  proc: ChildProcess | null;
  workspaceDir: string;
  transcriptFile: string;
  idleConfig: AgentRuntimeConfig;
  activeConfig?: AgentRuntimeConfig;
  driver: RuntimeDriver;
  inbox: QueuedDelivery[];
  retryAttempts: Map<string, number>;
  sessionId?: string;
  activeDeliveryId?: string;
  mcpBridgeSent?: boolean;
}

type QueuedDelivery = AgentDelivery & { inboxSummary?: string };

export class AgentProcessManager {
  private autoWorkTimer: NodeJS.Timeout | null = null;
  private agents = new Map<string, AgentEntry>();
  private workspaceBase: string;
  private onMessage: AgentMessageCallback;
  private onStatus: AgentStatusCallback;
  private onActivity: AgentActivityCallback;
  private onDm: AgentDmCallback;
  private onDelegate: AgentDelegateCallback;
  private onCreateTask: AgentCreateTaskCallback;
  private onUpdateTask: AgentUpdateTaskCallback;
  private onSetReminder: AgentSetReminderCallback;
  private onCancelReminder: AgentCancelReminderCallback;
  private onSession: AgentSessionCallback;
  private serverUrl: string;

  constructor(
    workspaceBase: string,
    onMessage: AgentMessageCallback,
    onStatus: AgentStatusCallback,
    onActivity: AgentActivityCallback = () => {},
    onDm: AgentDmCallback = () => {},
    onDelegate: AgentDelegateCallback = () => {},
    onCreateTask: AgentCreateTaskCallback = () => {},
    onUpdateTask: AgentUpdateTaskCallback = () => {},
    onSetReminder: AgentSetReminderCallback = () => {},
    onCancelReminder: AgentCancelReminderCallback = () => {},
    onSession: AgentSessionCallback = () => {},
    serverUrl = 'http://localhost:3000'
  ) {
    this.workspaceBase = workspaceBase;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onActivity = onActivity;
    this.onDm = onDm;
    this.onDelegate = onDelegate;
    this.onCreateTask = onCreateTask;
    this.onUpdateTask = onUpdateTask;
    this.onSetReminder = onSetReminder;
    this.onCancelReminder = onCancelReminder;
    this.onSession = onSession;
    this.serverUrl = serverUrl;
    if (!process.env.CREWDEN_DISABLE_AUTO_WORK && process.env.NODE_ENV !== 'test') {
      this.startAutoWorkLoop();
    }
  }

  /** Public wrapper so external code (e.g. daemonClient) can emit activity updates */
  emitActivity(agentId: string, type: AgentActivity['type'], detail?: string): void {
    this.onActivity(agentId, type, detail);
  }

  private startAutoWorkLoop(): void {
    if (this.autoWorkTimer) return;
    const intervalMs = Number(process.env.CREWDEN_AUTO_WORK_POLL_MS) || 30000;
    this.autoWorkTimer = setInterval(() => void this.runAutoWorkCheck(), intervalMs);
  }

  private stopAutoWorkLoop(): void {
    if (!this.autoWorkTimer) return;
    clearInterval(this.autoWorkTimer);
    this.autoWorkTimer = null;
  }

  private async runAutoWorkCheck(): Promise<void> {
    try {
      for (const entry of this.agents.values()) {
        const cfg = entry.idleConfig;
        if (!cfg?.autoWork?.enabled) continue;
        if (entry.proc || entry.inbox.length > 0) continue;
        const token = cfg.agentToken;
        if (!token) continue;
        let res: any;
        try {
          res = await callInternalApi({ command: { method: 'GET', path: '/work' }, agentId: entry.agentId, serverUrl: this.serverUrl, token, fetchImpl: fetch });
        } catch (err) {
          continue;
        }
        const inbox = Array.isArray(res?.inbox) ? res.inbox : [];
        const claimable = inbox.find((i: any) => i.kind === 'claimable_task' && i.taskId);
        if (claimable) {
          try {
            await callInternalApi({ command: { method: 'POST', path: `/tasks/${claimable.taskId}/claim`, body: {} }, agentId: entry.agentId, serverUrl: this.serverUrl, token, fetchImpl: fetch });
            // Wake the agent with an inbox summary so it starts processing
            await this.deliverMessage(entry.agentId, toInboxSummaryDelivery(entry.agentId), entry.idleConfig, entry.channelId, await Promise.resolve(''));
          } catch (err) {
            // ignore claim errors
          }
        }
      }
    } catch (err) {
      console.error('[daemon] autoWork check error:', err instanceof Error ? err.message : String(err));
    }
  }

  async startAgent(agentId: string, config: AgentRuntimeConfig, channelId: string, wakeMessage?: AgentDelivery, inboxSummary?: string): Promise<void> {
    const driver = DRIVERS[config.runtime];
    if (!driver) throw new Error(`Unknown runtime: ${config.runtime}`);

    const existing = this.agents.get(agentId);
    if (existing) {
      await ensureAgentWorkspace(agentId, config, this.workspaceBase);
      existing.idleConfig = config;
      existing.channelId = channelId;
      existing.driver = driver;
      await this.ensureAgentTools(config, existing.workspaceDir);
      await this.prepareRuntimeWorkspace(existing, config);
      if (wakeMessage) {
        await this.enqueueMessage(existing, wakeMessage, inboxSummary);
      } else if (inboxSummary) {
        await this.enqueueMessage(existing, toInboxSummaryDelivery(agentId), inboxSummary);
      }
      this.onStatus(agentId, existing.proc ? 'working' : 'idle');
      this.runNext(existing);
      return;
    }

    const { root: workspaceDir } = await ensureAgentWorkspace(agentId, config, this.workspaceBase);
    const transcriptFile = join(workspaceDir, 'transcript.txt');
    await this.ensureAgentTools(config, workspaceDir);

    this.agents.set(agentId, {
      agentId,
      channelId,
      registered: true,
      processStatus: 'idle',
      proc: null,
      workspaceDir,
      transcriptFile,
      idleConfig: config,
      driver,
      inbox: [],
      retryAttempts: new Map(),
    });
    const entry = this.agents.get(agentId)!;
    await this.prepareRuntimeWorkspace(entry, config);
    if (wakeMessage) {
      await this.enqueueMessage(entry, wakeMessage, inboxSummary);
    } else if (inboxSummary) {
      await this.enqueueMessage(entry, toInboxSummaryDelivery(agentId), inboxSummary);
    }
    this.onStatus(agentId, 'idle');
    this.runNext(entry);
  }

  async deliverMessage(agentId: string, delivery: AgentDelivery, config?: AgentRuntimeConfig, channelId?: string, inboxSummary?: string): Promise<void> {
    let entry = this.agents.get(agentId);

    if (!entry) {
      if (!config) {
        const message = `Agent ${agentId} is not registered on this daemon`;
        this.onActivity(agentId, 'error', message);
        throw new Error(message);
      }
      await this.startAgent(agentId, config, channelId ?? delivery.channelId);
      entry = this.agents.get(agentId);
      if (!entry) throw new Error(`Agent ${agentId} failed to register`);
    } else if (config) {
      entry.idleConfig = config;
      entry.driver = DRIVERS[config.runtime] ?? entry.driver;
      entry.channelId = channelId ?? entry.channelId;
      await this.ensureAgentTools(config, entry.workspaceDir);
      await this.prepareRuntimeWorkspace(entry, config);
    }

    await this.enqueueMessage(entry, delivery, inboxSummary);
    this.onActivity(agentId, 'working', 'Message received');
    if (entry.proc) {
      if (!entry.activeDeliveryId && entry.driver.capabilities.supportsStdinDelivery) {
        this.sendNextToActiveProcess(entry);
      }
      this.notifyBusyAgent(entry);
      return;
    }
    this.runNext(entry);
  }

  private async enqueueMessage(entry: AgentEntry, delivery: AgentDelivery, inboxSummary?: string): Promise<void> {
    entry.inbox.push({ ...delivery, inboxSummary });
    await this.appendTranscript(entry, delivery.senderName, delivery.content, delivery.createdAt);
  }

  private runNext(entry: AgentEntry): void {
    if (entry.proc || entry.inbox.length === 0) return;

    const delivery = entry.inbox[0];
    const config = entry.idleConfig;
    entry.activeConfig = config;
    entry.activeDeliveryId = delivery.id;
    entry.processStatus = 'starting';
    this.onStatus(entry.agentId, 'working');

    const ctx = this.buildSpawnContext(entry, delivery);
    const cmd = entry.driver.buildCommand(ctx);

    const displayArgs = cmd.args.map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a));
    console.log(`[daemon] spawning: ${cmd.cmd} ${displayArgs.join(' ')}`);
    this.onActivity(entry.agentId, 'thinking');

    const proc = spawn(cmd.cmd, cmd.args, {
      cwd: entry.workspaceDir,
      env: {
        ...process.env,
        ...cmd.env,
        ...config.envVars,
        PATH: `${join(entry.workspaceDir, '.crewden')}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ''}`,
        CREWDEN_AGENT_ID: entry.agentId,
        CREWDEN_SERVER_URL: this.serverUrl,
        CREWDEN_AGENT_TOKEN_FILE: this.agentTokenFile(entry),
        CREWDEN_RUNTIME_STDOUT_ACK: '1',
      },
      stdio: [cmd.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    entry.proc = proc;
    entry.processStatus = 'active';

    if (cmd.stdin) {
      try {
        proc.stdin?.write(`${cmd.stdin}\n`);
      } catch (err) {
        this.onActivity(entry.agentId, 'error', err instanceof Error ? err.message : 'Failed to write stdin');
      }
    }

    let outputBuffer = '';
    let fullStdout = '';
    let fullStderr = '';
    let bridgeMessageSent = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[agent:${entry.agentId}:stdout] ${text}`);
      fullStdout += text;
      outputBuffer += text;
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? '';
      for (const l of lines) {
        if (this.handleOutputLine(entry, l)) bridgeMessageSent = true;
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      fullStderr += text;
      process.stderr.write(`[agent:${entry.agentId}:stderr] ${text}`);
    });

    proc.on('close', (code) => {
      console.log(`[daemon] agent ${entry.agentId} process exited with code ${code}`);
      if (outputBuffer.trim()) {
        if (this.handleOutputLine(entry, outputBuffer.trim())) bridgeMessageSent = true;
      }
      if (code === 0 && entry.inbox[0]?.id === entry.activeDeliveryId) {
        entry.inbox.shift();
      }
      if (code === 0 && entry.activeDeliveryId) {
        entry.retryAttempts.delete(entry.activeDeliveryId);
      }
      if (code === 0 && !bridgeMessageSent) {
        const fallback = fullStdout.trim();
        if (fallback) {
          console.log(`[daemon] agent ${entry.agentId} fallback reply (no bridge marker found)`);
          this.appendTranscriptLater(entry, this.agentTranscriptName(entry), fallback);
          this.onMessage(entry.agentId, entry.channelId, fallback);
          this.onActivity(entry.agentId, 'output', fallback.slice(0, 100));
        }
      }
      if (code !== 0 && this.handleFailedProcess(entry, code, fullStderr)) {
        return;
      }
      entry.proc = null;
      entry.activeConfig = undefined;
      entry.activeDeliveryId = undefined;
      entry.processStatus = code === 0 ? 'idle' : 'error';
      this.onActivity(entry.agentId, code === 0 ? 'idle' : 'error', code === 0 ? undefined : `process exited with code ${code}`);
      this.onStatus(entry.agentId, code === 0 ? 'idle' : 'error');
      if (code === 0 && entry.inbox.length > 0) {
        this.runNext(entry);
      }
    });

    proc.on('error', (err) => {
      console.error(`[daemon] agent ${entry.agentId} spawn error:`, err.message);
      entry.proc = null;
      entry.activeConfig = undefined;
      entry.activeDeliveryId = undefined;
      entry.processStatus = 'error';
      this.onActivity(entry.agentId, 'error', err.message);
      this.onStatus(entry.agentId, 'error');
    });
  }

  private notifyBusyAgent(entry: AgentEntry): void {
    if (!entry.driver.capabilities.supportsStdinDelivery || entry.driver.capabilities.busyDeliveryMode !== 'notification') return;
    const message = this.buildUnreadSummary(entry, entry.inbox.length);
    try {
      const encoded = entry.driver.encodeStdinMessage?.(message, entry.sessionId);
      if (encoded) entry.proc?.stdin?.write(`${encoded}\n`);
      this.onActivity(entry.agentId, 'working', 'Queued message notification sent');
    } catch (err) {
      this.onActivity(entry.agentId, 'error', err instanceof Error ? err.message : 'Failed to send busy notification');
    }
  }

  private handleFailedProcess(entry: AgentEntry, code: number | null, stderr: string): boolean {
    const activeDeliveryId = entry.activeDeliveryId;
    const failureClass = classifyAgentFailure(stderr);
    if (failureClass === 'transient' && activeDeliveryId) {
      const attempt = (entry.retryAttempts.get(activeDeliveryId) ?? 1) + 1;
      if (attempt <= MAX_TRANSIENT_ATTEMPTS) {
        entry.retryAttempts.set(activeDeliveryId, attempt);
        entry.proc = null;
        entry.activeConfig = undefined;
        entry.activeDeliveryId = undefined;
        entry.processStatus = 'idle';
        const delay = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 2);
        this.onActivity(entry.agentId, 'working', `Retrying after transient failure (${attempt}/${MAX_TRANSIENT_ATTEMPTS})`);
        setTimeout(() => this.runNext(entry), delay);
        return true;
      }
    }

    if (failureClass === 'permanent') {
      const activeDelivery = activeDeliveryId
        ? entry.inbox.find((delivery) => delivery.id === activeDeliveryId)
        : entry.inbox[0];
      const taskId = activeDelivery ? extractTaskId(activeDelivery) : undefined;
      if (taskId) {
        this.onUpdateTask(entry.agentId, taskId, 'blocked');
        if (entry.inbox[0]?.id === activeDeliveryId) entry.inbox.shift();
      }
      this.onActivity(entry.agentId, 'error', `Permanent failure: ${summarizeFailure(stderr, code)}`);
    }

    return false;
  }

  private sendNextToActiveProcess(entry: AgentEntry): void {
    if (!entry.proc || entry.inbox.length === 0 || !entry.driver.encodeStdinMessage) return;
    const delivery = entry.inbox[0];
    const ctx = this.buildSpawnContext(entry, delivery);
    try {
      entry.activeDeliveryId = delivery.id;
      entry.proc.stdin?.write(`${entry.driver.encodeStdinMessage(ctx.formattedMessage, entry.sessionId)}\n`);
      this.onActivity(entry.agentId, 'thinking');
    } catch (err) {
      entry.activeDeliveryId = undefined;
      this.onActivity(entry.agentId, 'error', err instanceof Error ? err.message : 'Failed to write stdin');
    }
  }

  private buildSpawnContext(entry: AgentEntry, delivery: QueuedDelivery): AgentSpawnContext {
    const queuedCount = entry.inbox.length;
    return {
      agentId: entry.agentId,
      config: entry.idleConfig,
      workspaceDir: entry.workspaceDir,
      transcriptFile: entry.transcriptFile,
      userMessage: delivery.content,
      formattedMessage: this.buildWakePrompt(entry, delivery, queuedCount),
      sessionId: entry.driver.capabilities.supportsSessionResume ? entry.sessionId : undefined,
      serverUrl: this.serverUrl,
      agentTokenFile: this.agentTokenFile(entry),
      unreadSummary: {
        queuedCount,
        newestMessageAt: entry.inbox.at(-1)?.createdAt,
      },
      contextBlocks: [],
    };
  }

  private buildWakePrompt(entry: AgentEntry, delivery: QueuedDelivery, queuedCount: number): string {
    const parts = [
      this.buildUnreadSummary(entry, queuedCount),
      this.formatDelivery(delivery),
    ];
    if (delivery.inboxSummary) {
      parts.push(['Current task inbox summary:', delivery.inboxSummary].join('\n'));
    }
    if (delivery.threadRootId) {
      parts.push(`This delivery is inside thread ${delivery.threadRootId}. Keep your reply in that thread. If using the crewden CLI, include \`--thread-root-id ${delivery.threadRootId}\`.`);
    }
    return parts.join('\n\n');
  }

  private buildUnreadSummary(entry: AgentEntry, queuedCount: number): string {
    const channel = entry.inbox[0]?.channelName ?? entry.channelId;
    return [
      `You have ${queuedCount} queued message${queuedCount === 1 ? '' : 's'}.`,
      `Use \`crewden message check\` or \`crewden message read --channel ${channel} --limit ${Math.max(queuedCount, 1)}\` if needed.`,
    ].join('\n');
  }

  private formatDelivery(delivery: AgentDelivery): string {
    const thread = delivery.threadRootId ? ` thread=${delivery.threadRootId}` : '';
    return `[target=#${delivery.channelName} msg=${delivery.id}${thread} time=${delivery.createdAt} type=human] @${delivery.senderName}: ${delivery.content}`;
  }

  private handleOutputLine(entry: AgentEntry, line: string): boolean {
    const parsed = entry.driver.parseOutput?.(line);
    if (parsed?.type === 'mcp_bridge_send') {
      console.log(`[daemon] agent ${entry.agentId} mcp bridge send: ${parsed.tool}`);
      entry.mcpBridgeSent = true;
      this.onActivity(entry.agentId, 'sending', `mcp:${parsed.tool}`);
      return true;
    }
    if (parsed?.type === 'message') {
      if (entry.mcpBridgeSent) {
        console.log(`[daemon] agent ${entry.agentId} text suppressed (mcp bridge already sent)`);
        return true;
      }
      console.log(`[daemon] agent ${entry.agentId} reply: ${parsed.content}`);
      this.appendTranscriptLater(entry, this.agentTranscriptName(entry), parsed.content);
      const activeDelivery = entry.inbox.find((delivery) => delivery.id === entry.activeDeliveryId) ?? entry.inbox[0];
      this.onMessage(entry.agentId, entry.channelId, parsed.content, activeDelivery?.threadRootId);
      this.onActivity(entry.agentId, 'sending', `channel:${entry.channelId}`);
      return true;
    }
    if (parsed?.type === 'dm') {
      console.log(`[daemon] agent ${entry.agentId} dm to ${parsed.toAgentId}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> dm:${parsed.toAgentId}`, parsed.content);
      this.onDm(entry.agentId, parsed.toAgentId, parsed.content);
      this.onActivity(entry.agentId, 'sending', `dm:${parsed.toAgentId}`);
      return true;
    }
    if (parsed?.type === 'delegate') {
      console.log(`[daemon] agent ${entry.agentId} delegate to ${parsed.toAgentId}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> delegate:${parsed.toAgentId}`, parsed.content);
      this.onDelegate(entry.agentId, parsed.toAgentId, parsed.content, parsed.startIfInactive);
      this.onActivity(entry.agentId, 'sending', `delegating to ${parsed.toAgentId}`);
      return true;
    }
    if (parsed?.type === 'create_task') {
      console.log(`[daemon] agent ${entry.agentId} create task: ${parsed.title}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> task:create`, parsed.title);
      this.onCreateTask(entry.agentId, parsed.title, parsed.channelId, parsed.assigneeId);
      this.onActivity(entry.agentId, 'sending', 'creating task');
      return true;
    }
    if (parsed?.type === 'update_task') {
      console.log(`[daemon] agent ${entry.agentId} update task ${parsed.taskId}: ${parsed.status}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> task:${parsed.taskId}`, parsed.status);
      this.onUpdateTask(entry.agentId, parsed.taskId, parsed.status);
      this.onActivity(entry.agentId, 'sending', `task:${parsed.taskId}`);
      return true;
    }
    if (parsed?.type === 'set_reminder') {
      console.log(`[daemon] agent ${entry.agentId} set reminder: ${parsed.triggerAt}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> reminder:set`, `${parsed.triggerAt} ${parsed.message}`);
      this.onSetReminder(entry.agentId, parsed.message, parsed.triggerAt, parsed.channelId ?? entry.channelId);
      this.onActivity(entry.agentId, 'sending', 'setting reminder');
      return true;
    }
    if (parsed?.type === 'cancel_reminder') {
      console.log(`[daemon] agent ${entry.agentId} cancel reminder ${parsed.reminderId}`);
      this.appendTranscriptLater(entry, `${this.agentTranscriptName(entry)} -> reminder:cancel`, parsed.reminderId);
      this.onCancelReminder(entry.agentId, parsed.reminderId);
      this.onActivity(entry.agentId, 'sending', `reminder:${parsed.reminderId}`);
      return true;
    }
    if (parsed?.type === 'external_action') {
      const detail = parsed.command ? `cli:${parsed.command}` : 'cli action';
      console.log(`[daemon] agent ${entry.agentId} external action acknowledged: ${detail}`);
      this.onActivity(entry.agentId, 'sending', detail);
      return true;
    }
    if (parsed?.type === 'session_init') {
      entry.sessionId = parsed.sessionId;
      this.onSession(entry.agentId, parsed.sessionId);
      this.onActivity(entry.agentId, 'working', `session:${parsed.sessionId}`);
      return true;
    }
    if (parsed?.type === 'turn_end') {
      entry.mcpBridgeSent = false;
      if (parsed.sessionId) {
        entry.sessionId = parsed.sessionId;
        this.onSession(entry.agentId, parsed.sessionId);
      }
      if (entry.inbox[0]?.id === entry.activeDeliveryId) {
        entry.inbox.shift();
      }
      entry.activeDeliveryId = undefined;
      if (entry.inbox.length > 0) {
        this.sendNextToActiveProcess(entry);
      } else {
        this.onActivity(entry.agentId, 'idle');
        this.onStatus(entry.agentId, 'idle');
      }
      return true;
    }
    if (parsed?.type === 'activity') {
      this.onActivity(entry.agentId, 'working', parsed.detail);
      return true;
    }
    return false;
  }

  private async appendTranscript(entry: AgentEntry, speaker: string, content: string, createdAt = new Date().toISOString()): Promise<void> {
    await appendFile(entry.transcriptFile, `[${createdAt}] ${speaker}: ${content}\n`);
  }

  private appendTranscriptLater(entry: AgentEntry, speaker: string, content: string): void {
    this.appendTranscript(entry, speaker, content).catch((err) => {
      console.error(`[daemon] failed to append transcript for ${entry.agentId}:`, err instanceof Error ? err.message : err);
    });
  }

  private agentTranscriptName(entry: AgentEntry): string {
    return entry.idleConfig.displayName ?? entry.idleConfig.name ?? entry.agentId;
  }

  private agentTokenFile(entry: AgentEntry): string {
    return join(entry.workspaceDir, '.crewden', 'agent-token');
  }

  private async prepareRuntimeWorkspace(entry: AgentEntry, config: AgentRuntimeConfig): Promise<void> {
    const ctx = this.buildSpawnContext(entry, {
      id: 'startup',
      channelId: entry.channelId,
      channelName: entry.channelId,
      senderName: 'system',
      content: '',
      createdAt: new Date().toISOString(),
    });
    await entry.driver.prepareWorkspace?.({ ...ctx, config, formattedMessage: '', userMessage: '' });
  }

  private async ensureAgentTools(config: AgentRuntimeConfig, workspaceDir: string): Promise<void> {
    await mkdir(workspaceDir, { recursive: true });
    const toolsDir = join(workspaceDir, '.crewden');
    await mkdir(toolsDir, { recursive: true });
    if (config.agentToken !== undefined) {
      await writeFile(join(toolsDir, 'agent-token'), `${config.agentToken}\n`, { mode: 0o600 });
    }
    const wrapperPath = join(toolsDir, 'crewden');
    await writeFile(wrapperPath, buildAgentCliWrapper(), { mode: 0o755 });
    await chmod(wrapperPath, 0o755);
  }

  stopAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.proc?.kill('SIGTERM');
    entry.proc = null;
    this.agents.delete(agentId);
    this.onStatus(agentId, 'inactive');
  }

  isRunning(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  listRunningAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  async readWorkspace(agentId: string, relPath: string): Promise<WorkspaceEntry | WorkspaceError> {
    return readAgentWorkspace(agentId, relPath, this.workspaceBase);
  }
}

function classifyAgentFailure(stderr: string): 'transient' | 'permanent' | 'unknown' {
  const text = stderr.toLowerCase();
  if (/(enotfound|econnreset|rate limit|timeout|timed out)/i.test(text)) return 'transient';
  if (/(auth|permission denied|command not found)/i.test(text)) return 'permanent';
  return 'unknown';
}

function extractTaskId(delivery: AgentDelivery): string | undefined {
  const channelMatch = delivery.channelId.match(/^task:([^:]+)$/);
  if (channelMatch) return channelMatch[1];
  const idMatch = delivery.id.match(/^task:([^:]+):/);
  return idMatch?.[1];
}

function summarizeFailure(stderr: string, code: number | null): string {
  const trimmed = stderr.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 200) : `process exited with code ${code}`;
}
