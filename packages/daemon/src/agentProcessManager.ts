import { appendFile, chmod, mkdir, writeFile } from 'fs/promises';
import { delimiter, dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import type { AgentRuntimeConfig, AgentDelivery, AgentActivity, WorkspaceEntry, WorkspaceError, TaskStatus } from '@mini-slock/shared';
import type { AgentSpawnContext, RuntimeDriver } from './drivers/types.js';
import { claudeDriver } from './drivers/claude.js';
import { codexDriver } from './drivers/codex.js';
import { geminiDriver } from './drivers/gemini.js';
import { ensureAgentWorkspace, readAgentWorkspace } from './workspace/agentWorkspace.js';

const DRIVERS: Record<string, RuntimeDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  gemini: geminiDriver,
};

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
    '  echo "xoxiang CLI is not built. Run: pnpm --filter @mini-slock/daemon build" >&2',
    '  exit 127',
    'fi',
    'exec node "$CLI" "$@"',
    '',
  ].join('\n');
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type AgentMessageCallback = (agentId: string, channelId: string, content: string) => void;
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
  inbox: AgentDelivery[];
  sessionId?: string;
  activeDeliveryId?: string;
}

export class AgentProcessManager {
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
  }

  async startAgent(agentId: string, config: AgentRuntimeConfig, channelId: string, wakeMessage?: AgentDelivery): Promise<void> {
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
      if (wakeMessage) await this.enqueueMessage(existing, wakeMessage);
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
    });
    const entry = this.agents.get(agentId)!;
    await this.prepareRuntimeWorkspace(entry, config);
    if (wakeMessage) await this.enqueueMessage(entry, wakeMessage);
    this.onStatus(agentId, 'idle');
    this.runNext(entry);
  }

  async deliverMessage(agentId: string, delivery: AgentDelivery, config?: AgentRuntimeConfig, channelId?: string): Promise<void> {
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

    await this.enqueueMessage(entry, delivery);
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

  private async enqueueMessage(entry: AgentEntry, delivery: AgentDelivery): Promise<void> {
    entry.inbox.push(delivery);
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
        PATH: `${join(entry.workspaceDir, '.xoxiang')}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ''}`,
        XOXIANG_AGENT_ID: entry.agentId,
        XOXIANG_SERVER_URL: this.serverUrl,
        XOXIANG_AGENT_TOKEN_FILE: this.agentTokenFile(entry),
      },
      stdio: [cmd.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
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
      process.stderr.write(`[agent:${entry.agentId}:stderr] ${chunk.toString()}`);
    });

    proc.on('close', (code) => {
      console.log(`[daemon] agent ${entry.agentId} process exited with code ${code}`);
      if (outputBuffer.trim()) {
        if (this.handleOutputLine(entry, outputBuffer.trim())) bridgeMessageSent = true;
      }
      if (code === 0 && entry.inbox[0]?.id === entry.activeDeliveryId) {
        entry.inbox.shift();
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

  private buildSpawnContext(entry: AgentEntry, delivery: AgentDelivery): AgentSpawnContext {
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

  private buildWakePrompt(entry: AgentEntry, delivery: AgentDelivery, queuedCount: number): string {
    return [
      this.buildUnreadSummary(entry, queuedCount),
      this.formatDelivery(delivery),
    ].join('\n\n');
  }

  private buildUnreadSummary(entry: AgentEntry, queuedCount: number): string {
    const channel = entry.inbox[0]?.channelName ?? entry.channelId;
    return [
      `You have ${queuedCount} queued message${queuedCount === 1 ? '' : 's'}.`,
      `Use \`xoxiang message check\` or \`xoxiang message read --channel ${channel} --limit ${Math.max(queuedCount, 1)}\` if needed.`,
    ].join('\n');
  }

  private formatDelivery(delivery: AgentDelivery): string {
    return `[target=#${delivery.channelName} msg=${delivery.id} time=${delivery.createdAt} type=human] @${delivery.senderName}: ${delivery.content}`;
  }

  private handleOutputLine(entry: AgentEntry, line: string): boolean {
    const parsed = entry.driver.parseOutput?.(line);
    if (parsed?.type === 'message') {
      console.log(`[daemon] agent ${entry.agentId} reply: ${parsed.content}`);
      this.appendTranscriptLater(entry, this.agentTranscriptName(entry), parsed.content);
      this.onMessage(entry.agentId, entry.channelId, parsed.content);
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
    if (parsed?.type === 'session_init') {
      entry.sessionId = parsed.sessionId;
      this.onSession(entry.agentId, parsed.sessionId);
      this.onActivity(entry.agentId, 'working', `session:${parsed.sessionId}`);
      return true;
    }
    if (parsed?.type === 'turn_end') {
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
    return join(entry.workspaceDir, '.xoxiang', 'agent-token');
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
    const toolsDir = join(workspaceDir, '.xoxiang');
    await mkdir(toolsDir, { recursive: true });
    if (config.agentToken !== undefined) {
      await writeFile(join(toolsDir, 'agent-token'), `${config.agentToken}\n`, { mode: 0o600 });
    }
    const wrapperPath = join(toolsDir, 'xoxiang');
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
