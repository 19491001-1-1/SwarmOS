export const BRIDGE_MARKER = '[[MINI_SLOCK_SEND_MESSAGE]]';
export const DM_BRIDGE_MARKER = '[[MINI_SLOCK_SEND_DM]]';
export const DELEGATE_BRIDGE_MARKER = '[[MINI_SLOCK_DELEGATE_AGENT]]';
export const CREATE_TASK_BRIDGE_MARKER = '[[MINI_SLOCK_CREATE_TASK]]';
export const UPDATE_TASK_BRIDGE_MARKER = '[[MINI_SLOCK_UPDATE_TASK]]';
export const SET_REMINDER_BRIDGE_MARKER = '[[MINI_SLOCK_SET_REMINDER]]';
export const CANCEL_REMINDER_BRIDGE_MARKER = '[[MINI_SLOCK_CANCEL_REMINDER]]';

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

export type ParsedBridgeSetReminder = {
  message: string;
  triggerAt: string;
  channelId?: string;
};

export type ParsedBridgeCancelReminder = {
  reminderId: string;
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

export function parseReminderLine(line: string): ParsedBridgeSetReminder | null {
  const idx = line.indexOf(SET_REMINDER_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + SET_REMINDER_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.message === 'string' && parsed.message.trim() && typeof parsed.triggerAt === 'string' && parsed.triggerAt.trim()) {
      return {
        message: parsed.message,
        triggerAt: parsed.triggerAt,
        channelId: typeof parsed.channelId === 'string' ? parsed.channelId : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseCancelReminderLine(line: string): ParsedBridgeCancelReminder | null {
  const idx = line.indexOf(CANCEL_REMINDER_BRIDGE_MARKER);
  if (idx === -1) return null;

  const jsonPart = line.slice(idx + CANCEL_REMINDER_BRIDGE_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (typeof parsed?.reminderId === 'string' && parsed.reminderId.trim()) {
      return { reminderId: parsed.reminderId };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildBridgeInstruction(): string {
  return [
    'Use xoxiang collaboration tools in this order: MCP tools when available, then the injected `xoxiang` CLI, then stdout marker fallback.',
    'Prefer MCP tools for structured reads, message sending, DMs, delegation, and server info because their results are machine-readable.',
    'If you use a tool or CLI command, base your answer on the real returned result; do not invent tool results.',
    'Injected `xoxiang` CLI commands:',
    '- `xoxiang message send --channel general --content "..."`',
    '- `xoxiang message send --channel general --thread-root-id <rootMessageId> --content "..."` to reply inside a thread',
    '- `xoxiang message check`',
    '- `xoxiang message read --channel general --limit 20`',
    '- `xoxiang agent list` to view the agent directory with names, roles, runtimes, and statuses',
    '- `xoxiang agent resolve "nickname or role"` to resolve user-facing names, display names, or role descriptions to a concrete agent id',
    '- `xoxiang task list` to view tasks assigned to you',
    '- `xoxiang task list --all` to view the whole task board, including unassigned tasks and tasks assigned to other agents',
    '- `xoxiang task read <taskId>` to inspect one task',
    '- `xoxiang task read <taskId> --context` to inspect the full agent handoff context for a task',
    '- `xoxiang task update <taskId> --status in_progress|in_review|done` to report progress',
    '- `xoxiang task handoff <taskId> --to agentId --notes "..." --next-step "..."` to transfer a task with execution context',
    '- `xoxiang goal list --channel general --status draft|confirmed` to inspect goal briefs',
    '- `xoxiang goal read <goalId>` to inspect one goal and its linked tasks',
    '- `xoxiang goal create --channel general --objective "..." --success "criterion one|criterion two"` to draft a structured goal brief',
    '- `xoxiang goal create-tasks <goalId> --tasks-json \'[{"title":"...","acceptanceCriteria":["..."]}]\'` to create contextual tasks from a confirmed goal',
    '- `xoxiang dm send --to agentId --content "..."`',
    '- `xoxiang agent delegate --to agentId --content "..." --start-if-inactive`',
    'Before delegating, DMing, or handing off to a human-described role, nickname, display name, or ambiguous name, resolve it with `xoxiang agent resolve "..."` and use the resolved agent id.',
    'When the user asks about unassigned tasks, all tasks, the whole task board, or another agent\'s tasks, use `xoxiang task list --all`; do not infer global task state from plain `xoxiang task list`.',
    'When taking over or handing off a task, read it with `--context` and preserve useful goal, background, acceptance criteria, artifacts, and next-step notes.',
    'When a user gives a broad multi-step objective, create or read a goal brief before creating many tasks; keep objective, success criteria, constraints, assumptions, and risks explicit.',
    'When the user asks to give, assign, transfer, or hand off todos/tasks, resolve the target agent, run `xoxiang task list --all`, pick concrete open tasks, and use `xoxiang task handoff`; do not use generic delegation when a concrete task exists.',
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
    'If the injected `xoxiang` CLI is available, resolve human display names or roles first and prefer task handoff for concrete tasks.',
    'Output exactly one delegation line and no extra prose:',
    `${DELEGATE_BRIDGE_MARKER} {"to":"agentId or agentName","content":"task details","startIfInactive":true}`,
    'Use a concrete agent id when known; otherwise preserve the user-facing target so the hub can resolve it by name, display name, or role hint.',
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

export function buildReminderInstruction(): string {
  return [
    'To schedule or cancel one-time reminders, output exactly one line and no extra prose:',
    `${SET_REMINDER_BRIDGE_MARKER} {"message":"reminder message","triggerAt":"<ISO8601>","channelId":"general"}`,
    `${CANCEL_REMINDER_BRIDGE_MARKER} {"reminderId":"reminder id"}`,
  ].join('\n');
}

export function buildMemoryInstruction(): string {
  return [
    'Workspace and durable memory rules:',
    '- Your current working directory is your persistent agent workspace.',
    '- Read `MEMORY.md` when you need durable identity, long-term context, or restart recovery context.',
    '- Keep durable working notes in `notes/`; use `notes/work-log.md` for important completed work and decisions.',
    '- Store user preferences in `notes/user-preferences.md` and channel background in `notes/channels.md` when useful.',
    '- Do not write secrets, auth tokens, API keys, or sensitive private data into MEMORY.md or notes.',
    '- After meaningful work, update MEMORY.md or notes only when it preserves useful future context.',
    '- Be deliberate about summarizing reusable knowledge: common tool commands and invocation patterns, project-specific lessons learned, and business/domain knowledge that will help future work.',
    '- Prefer concise, structured notes over raw chat logs; record why a tool or approach worked, when to reuse it, and any caveats.',
  ].join('\n');
}
