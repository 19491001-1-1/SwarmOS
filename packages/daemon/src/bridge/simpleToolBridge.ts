export const BRIDGE_MARKER = '[[MINI_SLOCK_SEND_MESSAGE]]';
export const DM_BRIDGE_MARKER = '[[MINI_SLOCK_SEND_DM]]';
export const DELEGATE_BRIDGE_MARKER = '[[MINI_SLOCK_DELEGATE_AGENT]]';
export const CREATE_TASK_BRIDGE_MARKER = '[[MINI_SLOCK_CREATE_TASK]]';
export const UPDATE_TASK_BRIDGE_MARKER = '[[MINI_SLOCK_UPDATE_TASK]]';

export type ParsedBridgeMessage = {
  content: string;
};

export type ParsedBridgeDm = {
  to: string;
  content: string;
};

export type ParsedBridgeDelegate = {
  to: string;
  content: string;
  startIfInactive?: boolean;
};

export type ParsedBridgeCreateTask = {
  title: string;
  assignee?: string;
  channel?: string;
};

export type ParsedBridgeUpdateTask = {
  taskId: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
};

export function parseBridgeLine(line: string): ParsedBridgeMessage | null {
  const idx = line.indexOf(BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.content === 'string') {
      return { content: parsed.content };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseDmLine(line: string): ParsedBridgeDm | null {
  const idx = line.indexOf(DM_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + DM_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.to === 'string' && typeof parsed?.content === 'string') {
      return { to: parsed.to, content: parsed.content };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseDelegateLine(line: string): ParsedBridgeDelegate | null {
  const idx = line.indexOf(DELEGATE_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + DELEGATE_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.to === 'string' && typeof parsed?.content === 'string') {
      return {
        to: parsed.to,
        content: parsed.content,
        startIfInactive: typeof parsed.startIfInactive === 'boolean' ? parsed.startIfInactive : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseCreateTaskLine(line: string): ParsedBridgeCreateTask | null {
  const idx = line.indexOf(CREATE_TASK_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + CREATE_TASK_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.title === 'string' && parsed.title.trim()) {
      return {
        title: parsed.title,
        assignee: typeof parsed.assignee === 'string' ? parsed.assignee : undefined,
        channel: typeof parsed.channel === 'string' ? parsed.channel : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseUpdateTaskLine(line: string): ParsedBridgeUpdateTask | null {
  const idx = line.indexOf(UPDATE_TASK_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + UPDATE_TASK_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    const validStatuses = new Set(['todo', 'in_progress', 'in_review', 'done']);
    if (typeof parsed?.taskId === 'string' && validStatuses.has(parsed.status)) {
      return { taskId: parsed.taskId, status: parsed.status };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildBridgeInstruction(): string {
  return [
    'Prefer the injected `xoxiang` CLI for collaboration:',
    '- `xoxiang message send --channel general --content "..."`',
    '- `xoxiang message check`',
    '- `xoxiang message read --channel general --limit 20`',
    '- `xoxiang agent list` to view the agent directory with names, roles, runtimes, and statuses',
    '- `xoxiang dm send --to agentName --content "..."`',
    '- `xoxiang agent delegate --to agentName --content "..." --start-if-inactive`',
    'When you are unsure how to do a task, need help, or need a specialist role, check `xoxiang agent list` first, then DM or delegate to the best matching agent.',
    'Never print or reveal the agent token file content.',
    `If the CLI is unavailable, send a chat reply by outputting exactly one line:\n${BRIDGE_MARKER} {"content":"your message here"}`,
  ].join('\n');
}

export function buildDmInstruction(): string {
  return `To send a direct message to another agent, output exactly one line:\n${DM_BRIDGE_MARKER} {"to":"agentId or agentName","content":"your private message here"}`;
}

export function buildDelegateInstruction(): string {
  return [
    'When the user asks you to ask, call, wake, delegate to, hand off to, or assign work to another xoxiang agent, do not do the task yourself.',
    'Output exactly one delegation line and no extra prose:',
    `${DELEGATE_BRIDGE_MARKER} {"to":"agentId or agentName","content":"task details","startIfInactive":true}`,
    'Use the agent name the user gave, preserving it as the target even if the casing differs.',
  ].join('\n');
}

export function buildTaskInstruction(): string {
  return [
    'To create or update task board items, output exactly one line and no extra prose:',
    `${CREATE_TASK_BRIDGE_MARKER} {"title":"task title","assignee":"agentId or agentName","channel":"general"}`,
    `${UPDATE_TASK_BRIDGE_MARKER} {"taskId":"task id","status":"todo|in_progress|in_review|done"}`,
    'Use channel "general" unless the user specified another channel.',
  ].join('\n');
}
