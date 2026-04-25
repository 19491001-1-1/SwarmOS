import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { AgentRuntimeConfig, AgentDelivery, AgentActivity } from '@mini-slock/shared';
import type { RuntimeDriver } from './drivers/types.js';
import { claudeDriver } from './drivers/claude.js';
import { codexDriver } from './drivers/codex.js';
import { geminiDriver } from './drivers/gemini.js';

const DRIVERS: Record<string, RuntimeDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  gemini: geminiDriver,
};

export type AgentMessageCallback = (agentId: string, channelId: string, content: string) => void;
export type AgentStatusCallback = (agentId: string, status: string) => void;
export type AgentActivityCallback = (agentId: string, type: AgentActivity['type'], detail?: string) => void;
export type AgentDmCallback = (fromAgentId: string, toAgentId: string, content: string) => void;
export type AgentDelegateCallback = (fromAgentId: string, toAgentId: string, content: string, startIfInactive?: boolean) => void;

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

  constructor(
    workspaceBase: string,
    onMessage: AgentMessageCallback,
    onStatus: AgentStatusCallback,
    onActivity: AgentActivityCallback = () => {},
    onDm: AgentDmCallback = () => {},
    onDelegate: AgentDelegateCallback = () => {}
  ) {
    this.workspaceBase = workspaceBase;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onActivity = onActivity;
    this.onDm = onDm;
    this.onDelegate = onDelegate;
  }

  async startAgent(agentId: string, config: AgentRuntimeConfig, channelId: string): Promise<void> {
    const driver = DRIVERS[config.runtime];
    if (!driver) throw new Error(`Unknown runtime: ${config.runtime}`);

    const workspaceDir = join(this.workspaceBase, agentId);
    const transcriptFile = join(workspaceDir, 'transcript.txt');

    if (!existsSync(workspaceDir)) {
      await mkdir(workspaceDir, { recursive: true });
    }

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
    const line = `[${delivery.createdAt}] ${delivery.senderName}: ${delivery.content}\n`;
    await appendFile(entry.transcriptFile, line);

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
      env: { ...process.env, ...cmd.env, ...entry.config.envVars },
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
      this.onMessage(entry.agentId, entry.channelId, parsed.content);
      this.onActivity(entry.agentId, 'sending', `channel:${entry.channelId}`);
      return true;
    }
    if (parsed?.type === 'dm') {
      console.log(`[daemon] agent ${entry.agentId} dm to ${parsed.toAgentId}`);
      this.onDm(entry.agentId, parsed.toAgentId, parsed.content);
      this.onActivity(entry.agentId, 'sending', `dm:${parsed.toAgentId}`);
      return true;
    }
    if (parsed?.type === 'delegate') {
      console.log(`[daemon] agent ${entry.agentId} delegate to ${parsed.toAgentId}`);
      this.onDelegate(entry.agentId, parsed.toAgentId, parsed.content, parsed.startIfInactive);
      this.onActivity(entry.agentId, 'sending', `delegating to ${parsed.toAgentId}`);
      return true;
    }
    return false;
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
}
