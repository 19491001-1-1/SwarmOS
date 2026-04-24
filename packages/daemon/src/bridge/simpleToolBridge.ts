export const BRIDGE_MARKER = '[[MINI_SLOCK_SEND_MESSAGE]]';

export type ParsedBridgeMessage = {
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

export function buildBridgeInstruction(): string {
  return `When you want to send a chat reply, output exactly one line:\n${BRIDGE_MARKER} {"content":"your message here"}`;
}
