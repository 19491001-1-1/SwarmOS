import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { claudeDriver } from '../src/drivers/claude.js';
import { codexDriver } from '../src/drivers/codex.js';
import { geminiDriver } from '../src/drivers/gemini.js';
import { BRIDGE_MARKER } from '../src/bridge/simpleToolBridge.js';
import type { AgentSpawnContext } from '../src/drivers/types.js';

const baseCtx: AgentSpawnContext = {
  agentId: 'agent-1',
  config: { runtime: 'claude', name: 'test-agent' },
  workspaceDir: '/tmp/workspace',
  transcriptFile: '/tmp/workspace/transcript.txt',
  userMessage: 'hello',
  formattedMessage: 'You have 1 queued message.\n\nhello',
  serverUrl: 'http://localhost:3000',
  agentTokenFile: '/tmp/workspace/.xoxiang/agent-token',
  contextBlocks: [],
};

describe('Claude driver', () => {
  it('command includes claude', () => {
    const cmd = claudeDriver.buildCommand(baseCtx);
    expect(cmd.cmd).toBe('claude');
  });

  it('includes model when specified', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, model: 'claude-3-opus' } };
    const cmd = claudeDriver.buildCommand(ctx);
    expect(cmd.args).toContain('--model');
    expect(cmd.args).toContain('claude-3-opus');
  });

  it('includes bridge instruction in system prompt', () => {
    const cmd = claudeDriver.buildCommand(baseCtx);
    const sysIdx = cmd.args.indexOf('--append-system-prompt');
    const sysPrompt = cmd.args[sysIdx + 1];
    expect(sysPrompt).toContain(BRIDGE_MARKER);
    expect(sysPrompt).toContain('MEMORY.md');
    expect(sysPrompt).toContain('persistent agent workspace');
  });

  it('uses stream-json stdin transport', () => {
    const cmd = claudeDriver.buildCommand(baseCtx);
    expect(cmd.args).toContain('--input-format');
    expect(cmd.args).toContain('stream-json');
    expect(cmd.args).toContain('--output-format');
    expect(cmd.stdin).toContain('"type":"user"');
    expect(cmd.stdin).toContain('You have 1 queued message');
  });

  it('includes resume session when available', () => {
    const cmd = claudeDriver.buildCommand({ ...baseCtx, sessionId: 'session-1' });
    expect(cmd.args).toContain('--resume');
    expect(cmd.args).toContain('session-1');
    expect(cmd.stdin).toContain('"session_id":"session-1"');
  });

  it('declares notification capabilities', () => {
    expect(claudeDriver.capabilities).toMatchObject({
      transport: 'stream-json',
      supportsStdinDelivery: true,
      busyDeliveryMode: 'notification',
      supportsSessionResume: true,
      supportsMcpBridge: true,
    });
  });

  it('writes and references Claude MCP config', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'xoxiang-claude-mcp-'));
    const ctx = { ...baseCtx, workspaceDir, agentTokenFile: join(workspaceDir, '.xoxiang', 'agent-token') };

    await claudeDriver.prepareWorkspace?.(ctx);
    const config = await readFile(join(workspaceDir, '.claude', 'xoxiang-mcp.json'), 'utf8');
    const cmd = claudeDriver.buildCommand(ctx);

    expect(config).toContain('"mcpServers"');
    expect(config).toContain('"mcp-bridge"');
    expect(cmd.args).toContain('--mcp-config');
    expect(cmd.args).toContain(join(workspaceDir, '.claude', 'xoxiang-mcp.json'));
  });

  it('parseOutput extracts bridge message', () => {
    const line = `${BRIDGE_MARKER} {"content":"Hello"}`;
    const event = claudeDriver.parseOutput!(line);
    expect(event?.type).toBe('message');
    expect((event as any).content).toBe('Hello');
  });

  it('parseOutput returns null for normal lines', () => {
    expect(claudeDriver.parseOutput!('just log output')).toBeNull();
  });

  it('parseOutput extracts session and turn events', () => {
    expect(claudeDriver.parseOutput!('{"type":"system","subtype":"init","session_id":"s1"}')).toEqual({ type: 'session_init', sessionId: 's1' });
    expect(claudeDriver.parseOutput!('{"type":"result","session_id":"s1"}')).toEqual({ type: 'turn_end', sessionId: 's1' });
  });
});

describe('Codex driver', () => {
  it('command includes codex', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'codex' as const } };
    const cmd = codexDriver.buildCommand(ctx);
    expect(cmd.cmd).toBe('codex');
  });

  it('prepends bridge prompt to the Codex user prompt', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'codex' as const } };
    const cmd = codexDriver.buildCommand(ctx);
    expect(cmd.args[1]).toContain(BRIDGE_MARKER);
    expect(cmd.args[1]).toContain('MEMORY.md');
    expect(cmd.args[1]).toContain('Current user message:');
    expect(cmd.args[1]).toContain('You have 1 queued message');
  });

  it('declares inbox capabilities', () => {
    expect(codexDriver.capabilities).toMatchObject({
      transport: 'oneshot',
      supportsStdinDelivery: false,
      busyDeliveryMode: 'inbox',
    });
  });

  it('includes model when specified', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'codex' as const, model: 'gpt-4o' } };
    const cmd = codexDriver.buildCommand(ctx);
    const modelArg = cmd.args.find((a) => a.startsWith('model='));
    expect(modelArg).toContain('gpt-4o');
  });

  it('bypasses sandbox so agent-facing CLI can reach the hub', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'codex' as const } };
    const cmd = codexDriver.buildCommand(ctx);
    expect(cmd.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(cmd.args).toContain('--sandbox');
    expect(cmd.args).toContain('danger-full-access');
  });
});

describe('Gemini driver', () => {
  it('command includes gemini', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const } };
    const cmd = geminiDriver.buildCommand(ctx);
    expect(cmd.cmd).toBe('gemini');
  });

  it('includes bridge prompt in GEMINI_SYSTEM_PROMPT env', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const } };
    const cmd = geminiDriver.buildCommand(ctx);
    expect(cmd.env?.GEMINI_SYSTEM_PROMPT).toContain(BRIDGE_MARKER);
    expect(cmd.env?.GEMINI_SYSTEM_PROMPT).toContain('MEMORY.md');
  });

  it('uses formatted wake prompt as prompt', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const } };
    const cmd = geminiDriver.buildCommand(ctx);
    const pIdx = cmd.args.indexOf('-p');
    expect(cmd.args[pIdx + 1]).toContain('You have 1 queued message');
  });

  it('includes model when specified', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const, model: 'gemini-pro' } };
    const cmd = geminiDriver.buildCommand(ctx);
    expect(cmd.args).toContain('-m');
    expect(cmd.args).toContain('gemini-pro');
  });

  it('disables sandbox and uses yolo approval mode', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const } };
    const cmd = geminiDriver.buildCommand(ctx);
    expect(cmd.args).toContain('--sandbox');
    expect(cmd.args).toContain('false');
    expect(cmd.args).toContain('--approval-mode');
    expect(cmd.args).toContain('yolo');
    expect(cmd.args).not.toContain('-y');
    expect(cmd.args).not.toContain('--yolo');
  });

  it('declares conservative MCP inbox capabilities', () => {
    expect(geminiDriver.capabilities).toMatchObject({
      transport: 'mcp',
      supportsStdinDelivery: false,
      busyDeliveryMode: 'inbox',
      supportsMcpBridge: true,
    });
  });
});
