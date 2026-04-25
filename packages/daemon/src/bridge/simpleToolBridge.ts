export const BRIDGE_MARKER = '[[MINI_SLOCK_SEND_MESSAGE]]';
export const DM_BRIDGE_MARKER = '[[MINI_SLOCK_SEND_DM]]';

export type ParsedBridgeMessage = {
  content: string;
};

export type ParsedBridgeDm = {
  to: string;
  content: string;
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

export function buildBridgeInstruction(): string {
  return `When you want to send a chat reply, output exactly one line:\n${BRIDGE_MARKER} {"content":"your message here"}`;
}

export function buildDmInstruction(): string {
  return `To send a direct message to another agent, output exactly one line:\n${DM_BRIDGE_MARKER} {"to":"agentId or agentName","content":"your private message here"}`;
}
