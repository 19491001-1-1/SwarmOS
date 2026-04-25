import { mkdir, appendFile, chmod, readdir, readFile, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { delimiter, dirname, isAbsolute, join, normalize, sep } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import type { AgentRuntimeConfig, AgentDelivery, AgentActivity, WorkspaceEntry, WorkspaceError, TaskStatus } from '@mini-slock/shared';
import type { RuntimeDriver } from './drivers/types.js';
import { claudeDriver } from './drivers/claude.js';
import { codexDriver } from './drivers/codex.js';
import { geminiDriver } from './drivers/gemini.js';

const DRIVERS: Record<string, RuntimeDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  gemini: geminiDriver,
};

const MAX_WORKSPACE_FILE_BYTES = 100 * 1024;

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

interface AgentEntry {
  agentId: string;
  channelId: string;
  proc: ChildProcess | null;
  workspaceDir: string;
  transcriptFile: string;
  config: AgentRuntimeConfig;
  driver: RuntimeDriver;
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
    this.serverUrl = serverUrl;
  }

  async startAgent(agentId: string, config: AgentRuntimeConfig, channelId: string): Promise<void> {
    const driver = DRIVERS[config.runtime];
    if (!driver) throw new Error(`Unknown runtime: ${config.runtime}`);

    const existing = this.agents.get(agentId);
    if (existing) {
      existing.config = config;
      existing.channelId = channelId;
      existing.driver = driver;
      await this.ensureAgentTools(config, existing.workspaceDir);
      this.onStatus(agentId, existing.proc ? 'working' : 'idle');
      return;
    }

    const workspaceDir = join(this.workspaceBase, agentId);
    const transcriptFile = join(workspaceDir, 'transcript.txt');

    if (!existsSync(workspaceDir)) {
      await mkdir(workspaceDir, { recursive: true });
    }
    await this.ensureAgentTools(config, workspaceDir);

    this.agents.set(agentId, {
      agentId,
      channelId,
      proc: null,
      workspaceDir,
      transcriptFile,
      config,
      driver,
    });
    this.onStatus(agentId, 'idle');
  }

  async deliverMessage(agentId: string, delivery: AgentDelivery): Promise<void> {
    let entry = this.agents.get(agentId);

    // Auto-recover: daemon may have restarted and lost the agent entry
    if (!entry) {
      console.log(`[daemon] agent ${agentId} not in map, auto-recovering for runtime unknown — skipping deliver`);
      throw new Error(`Agent ${agentId} not started on this daemon`);
    }

    // Append to transcript for context
    await this.appendTranscript(entry, delivery.senderName, delivery.content, delivery.createdAt);

    this.onActivity(agentId, 'working', 'Message received');
    this.onStatus(agentId, 'working');

    const ctx = {
      agentId,
      config: entry.config,
      workspaceDir: entry.workspaceDir,
      transcriptFile: entry.transcriptFile,
      userMessage: delivery.content,
    };

    const cmd = entry.driver.buildCommand(ctx);

    const displayArgs = cmd.args.map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a));
    console.log(`[daemon] spawning: ${cmd.cmd} ${displayArgs.join(' ')}`);
    this.onActivity(agentId, 'thinking');

    const proc = spawn(cmd.cmd, cmd.args, {
      cwd: entry.workspaceDir,
      env: {
        ...process.env,
        ...cmd.env,
        ...entry.config.envVars,
        PATH: `${join(entry.workspaceDir, '.xoxiang')}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ''}`,
        XOXIANG_AGENT_ID: entry.agentId,
        XOXIANG_SERVER_URL: this.serverUrl,
        XOXIANG_AGENT_TOKEN_FILE: join(entry.workspaceDir, '.xoxiang', 'agent-token'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    entry.proc = proc;

    let outputBuffer = '';
    let fullStdout = '';
    let bridgeMessageSent = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[agent:${agentId}:stdout] ${text}`);
      fullStdout += text;
      outputBuffer += text;
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? '';
      for (const l of lines) {
        if (this.handleOutputLine(entry!, l)) bridgeMessageSent = true;
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[agent:${agentId}:stderr] ${chunk.toString()}`);
    });

    proc.on('close', (code) => {
      console.log(`[daemon] agent ${agentId} process exited with code ${code}`);
      if (outputBuffer.trim()) {
        if (this.handleOutputLine(entry!, outputBuffer.trim())) bridgeMessageSent = true;
      }
      // Fallback: if no bridge message was sent, use the entire stdout as the reply
      if (!bridgeMessageSent) {
        const fallback = fullStdout.trim();
        if (fallback) {
          console.log(`[daemon] agent ${agentId} fallback reply (no bridge marker found)`);
          this.appendTranscriptLater(entry!, this.agentTranscriptName(entry!), fallback);
          this.onMessage(entry!.agentId, entry!.channelId, fallback);
          this.onActivity(agentId, 'output', fallback.slice(0, 100));
        }
      }
      entry!.proc = null;
      this.onActivity(agentId, 'idle');
      this.onStatus(agentId, 'idle');
    });

    proc.on('error', (err) => {
      console.error(`[daemon] agent ${agentId} spawn error:`, err.message);
      entry!.proc = null;
      this.onActivity(agentId, 'error', err.message);
      this.onStatus(agentId, 'error');
    });
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
    return entry.config.displayName ?? entry.config.name ?? entry.agentId;
  }

  private async ensureAgentTools(config: AgentRuntimeConfig, workspaceDir: string): Promise<void> {
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
    const safePath = normalize(relPath || '.');
    if (isAbsolute(relPath) || safePath === '..' || safePath.startsWith(`..${sep}`) || safePath.includes(`${sep}..${sep}`)) {
      return { type: 'error', error: 'Path traversal is not allowed', status: 403 };
    }

    const workspaceDir = this.agents.get(agentId)?.workspaceDir ?? join(this.workspaceBase, agentId);
    const targetPath = join(workspaceDir, safePath);
    const displayPath = safePath === '.' ? '' : safePath;

    try {
      const info = await stat(targetPath);
      if (info.isDirectory()) {
        const entries = await readdir(targetPath, { withFileTypes: true });
        const children = await Promise.all(entries.map(async (entry) => {
          const childPath = join(targetPath, entry.name);
          const childInfo = await stat(childPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'dir' as const : 'file' as const,
            size: childInfo.size,
            modifiedAt: childInfo.mtime.toISOString(),
          };
        }));
        children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return { type: 'dir', path: displayPath, children };
      }

      if (!info.isFile()) {
        return { type: 'error', error: 'Workspace path is not a file or directory', status: 400 };
      }

      const buffer = await readFile(targetPath);
      const truncated = buffer.byteLength > MAX_WORKSPACE_FILE_BYTES;
      const content = buffer.subarray(0, MAX_WORKSPACE_FILE_BYTES).toString('utf8');
      return { type: 'file', path: displayPath, content, truncated };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') return { type: 'error', error: 'Workspace path not found', status: 404 };
      return { type: 'error', error: err instanceof Error ? err.message : 'Failed to read workspace', status: 500 };
    }
  }
}
