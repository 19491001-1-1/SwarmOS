import { describe, it, expect } from 'vitest';
import {
  parseBridgeLine,
  parseDmLine,
  parseDelegateLine,
  BRIDGE_MARKER,
  DM_BRIDGE_MARKER,
  DELEGATE_BRIDGE_MARKER,
  buildBridgeInstruction,
  buildDmInstruction,
  buildDelegateInstruction,
} from '../src/bridge/simpleToolBridge.js';

describe('parseBridgeLine', () => {
  it('extracts content from valid line', () => {
    const line = `${BRIDGE_MARKER} {"content":"Hello world"}`;
    const result = parseBridgeLine(line);
    expect(result).not.toBeNull();
    expect(result?.content).toBe('Hello world');
  });

  it('ignores normal log lines', () => {
    expect(parseBridgeLine('Just some log output')).toBeNull();
    expect(parseBridgeLine('Processing request...')).toBeNull();
    expect(parseBridgeLine('')).toBeNull();
  });

  it('returns null for invalid JSON after marker', () => {
    const line = `${BRIDGE_MARKER} not-json`;
    expect(parseBridgeLine(line)).toBeNull();
  });

  it('returns null when content field is missing', () => {
    const line = `${BRIDGE_MARKER} {"other":"field"}`;
    expect(parseBridgeLine(line)).toBeNull();
  });

  it('handles marker with preceding text', () => {
    const line = `some prefix ${BRIDGE_MARKER} {"content":"reply"}`;
    const result = parseBridgeLine(line);
    expect(result?.content).toBe('reply');
  });

  it('instructs agents to use the agent directory before asking for help', () => {
    const instruction = buildBridgeInstruction();
    expect(instruction).toContain('xoxiang agent list');
    expect(instruction).toContain('need a specialist role');
  });
});

describe('parseDelegateLine', () => {
  it('extracts target, content, and start flag from valid delegation line', () => {
    const result = parseDelegateLine(`${DELEGATE_BRIDGE_MARKER} {"to":"agent-2","content":"do this","startIfInactive":true}`);
    expect(result).toEqual({ to: 'agent-2', content: 'do this', startIfInactive: true });
  });

  it('allows omitted start flag', () => {
    const result = parseDelegateLine(`${DELEGATE_BRIDGE_MARKER} {"to":"agent-2","content":"do this"}`);
    expect(result).toEqual({ to: 'agent-2', content: 'do this', startIfInactive: undefined });
  });

  it('returns null for invalid JSON or missing fields', () => {
    expect(parseDelegateLine(`${DELEGATE_BRIDGE_MARKER} not-json`)).toBeNull();
    expect(parseDelegateLine(`${DELEGATE_BRIDGE_MARKER} {"content":"missing target"}`)).toBeNull();
    expect(parseDelegateLine(`${DELEGATE_BRIDGE_MARKER} {"to":"agent-2"}`)).toBeNull();
  });

  it('includes the delegation marker in the generated instruction', () => {
    expect(buildDelegateInstruction()).toContain(DELEGATE_BRIDGE_MARKER);
  });

  it('instructs agents to delegate user handoff requests instead of doing them locally', () => {
    const instruction = buildDelegateInstruction();
    expect(instruction).toContain('do not do the task yourself');
    expect(instruction).toContain('wake');
    expect(instruction).toContain('delegate');
  });
});

describe('parseDmLine', () => {
  it('extracts target and content from valid DM line', () => {
    const result = parseDmLine(`${DM_BRIDGE_MARKER} {"to":"agent-2","content":"hello privately"}`);
    expect(result).toEqual({ to: 'agent-2', content: 'hello privately' });
  });

  it('handles marker with preceding text', () => {
    const result = parseDmLine(`prefix ${DM_BRIDGE_MARKER} {"to":"receiver","content":"secret"}`);
    expect(result?.to).toBe('receiver');
    expect(result?.content).toBe('secret');
  });

  it('returns null for invalid JSON after marker', () => {
    expect(parseDmLine(`${DM_BRIDGE_MARKER} not-json`)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseDmLine(`${DM_BRIDGE_MARKER} {"content":"missing target"}`)).toBeNull();
    expect(parseDmLine(`${DM_BRIDGE_MARKER} {"to":"agent-2"}`)).toBeNull();
  });

  it('includes the DM marker in the generated instruction', () => {
    expect(buildDmInstruction()).toContain(DM_BRIDGE_MARKER);
  });
});
