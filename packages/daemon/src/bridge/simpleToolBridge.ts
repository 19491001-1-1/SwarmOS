export const BRIDGE_MARKER = '[[MINI_SLOCK_SEND_MESSAGE]]';
export const DM_BRIDGE_MARKER = '[[MINI_SLOCK_SEND_DM]]';
export const DELEGATE_BRIDGE_MARKER = '[[MINI_SLOCK_DELEGATE_AGENT]]';

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

export function buildBridgeInstruction(): string {
  return `When you want to send a chat reply, output exactly one line:\n${BRIDGE_MARKER} {"content":"your message here"}`;
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
