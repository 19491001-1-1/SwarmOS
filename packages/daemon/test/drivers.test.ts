import { describe, it, expect } from 'vitest';
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
    const sysIdx = cmd.args.indexOf('--system-prompt');
    const sysPrompt = cmd.args[sysIdx + 1];
    expect(sysPrompt).toContain(BRIDGE_MARKER);
  });

  it('passes userMessage as -p positional arg', () => {
    const cmd = claudeDriver.buildCommand(baseCtx);
    const pIdx = cmd.args.indexOf('-p');
    expect(cmd.args[pIdx + 1]).toBe('hello');
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
    expect(cmd.args[1]).toContain('Current user message:');
    expect(cmd.args[1]).toContain('hello');
  });

  it('includes model when specified', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'codex' as const, model: 'gpt-4o' } };
    const cmd = codexDriver.buildCommand(ctx);
    const modelArg = cmd.args.find((a) => a.startsWith('model='));
    expect(modelArg).toContain('gpt-4o');
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
  });

  it('includes model when specified', () => {
    const ctx = { ...baseCtx, config: { ...baseCtx.config, runtime: 'gemini' as const, model: 'gemini-pro' } };
    const cmd = geminiDriver.buildCommand(ctx);
    expect(cmd.args).toContain('-m');
    expect(cmd.args).toContain('gemini-pro');
  });
});
