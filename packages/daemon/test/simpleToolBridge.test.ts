import { describe, it, expect } from 'vitest';
import {
  parseBridgeLine,
  parseDmLine,
  parseDelegateLine,
  parseCreateTaskLine,
  parseUpdateTaskLine,
  BRIDGE_MARKER,
  DM_BRIDGE_MARKER,
  DELEGATE_BRIDGE_MARKER,
  buildBridgeInstruction,
  CREATE_TASK_BRIDGE_MARKER,
  UPDATE_TASK_BRIDGE_MARKER,
  SET_REMINDER_BRIDGE_MARKER,
  CANCEL_REMINDER_BRIDGE_MARKER,
  buildDmInstruction,
  buildDelegateInstruction,
  buildTaskInstruction,
  buildMemoryInstruction,
  parseReminderLine,
  parseCancelReminderLine,
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
    expect(instruction).toContain('MCP tools when available');
    expect(instruction).toContain('do not invent tool results');
    expect(instruction).toContain('xoxiang agent list');
    expect(instruction).toContain('xoxiang agent resolve');
    expect(instruction).toContain('need a specialist role');
    expect(instruction).toContain('human-described role');
  });

  it('instructs agents to use all tasks for unassigned or global task questions', () => {
    const instruction = buildBridgeInstruction();
    expect(instruction).toContain('xoxiang task list --all');
    expect(instruction).toContain('xoxiang task handoff');
    expect(instruction).toContain('unassigned tasks');
    expect(instruction).toContain('do not infer global task state from plain `xoxiang task list`');
  });
});

describe('memory instruction', () => {
  it('instructs agents to use durable workspace memory and notes', () => {
    const instruction = buildMemoryInstruction();
    expect(instruction).toContain('persistent agent workspace');
    expect(instruction).toContain('MEMORY.md');
    expect(instruction).toContain('notes/work-log.md');
    expect(instruction).toContain('Do not write secrets');
    expect(instruction).toContain('common tool commands and invocation patterns');
    expect(instruction).toContain('project-specific lessons learned');
    expect(instruction).toContain('business/domain knowledge');
    expect(instruction).toContain('why a tool or approach worked');
  });
});

describe('reminder bridge markers', () => {
  it('parses set reminder lines', () => {
    expect(parseReminderLine(`${SET_REMINDER_BRIDGE_MARKER} {"message":"hello","triggerAt":"2026-04-25T12:00:00.000Z","channelId":"general"}`)).toEqual({
      message: 'hello',
      triggerAt: '2026-04-25T12:00:00.000Z',
      channelId: 'general',
    });
  });

  it('parses cancel reminder lines', () => {
    expect(parseCancelReminderLine(`${CANCEL_REMINDER_BRIDGE_MARKER} {"reminderId":"rem-1"}`)).toEqual({ reminderId: 'rem-1' });
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

describe('task bridge lines', () => {
  it('extracts task creation fields', () => {
    const result = parseCreateTaskLine(`${CREATE_TASK_BRIDGE_MARKER} {"title":"Fix daemon handoff","assignee":"codex","channel":"general"}`);
    expect(result).toEqual({ title: 'Fix daemon handoff', assignee: 'codex', channel: 'general' });
  });

  it('extracts task status updates', () => {
    const result = parseUpdateTaskLine(`${UPDATE_TASK_BRIDGE_MARKER} {"taskId":"task-1","status":"in_progress"}`);
    expect(result).toEqual({ taskId: 'task-1', status: 'in_progress' });
  });

  it('rejects invalid task bridge lines', () => {
    expect(parseCreateTaskLine(`${CREATE_TASK_BRIDGE_MARKER} {"title":""}`)).toBeNull();
    expect(parseUpdateTaskLine(`${UPDATE_TASK_BRIDGE_MARKER} {"taskId":"task-1","status":"blocked"}`)).toBeNull();
  });

  it('includes task markers in generated instructions', () => {
    const instruction = buildTaskInstruction();
    expect(instruction).toContain(CREATE_TASK_BRIDGE_MARKER);
    expect(instruction).toContain(UPDATE_TASK_BRIDGE_MARKER);
  });
});
