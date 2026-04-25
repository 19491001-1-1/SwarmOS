import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine } from '../bridge/simpleToolBridge.js';

export const geminiDriver: RuntimeDriver = {
  id: 'gemini',

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
    ]
      .filter(Boolean)
      .join('\n\n');

    // gemini -p "<prompt>" --output-format text -y
    // system prompt via GEMINI_SYSTEM_PROMPT env var (gemini CLI reads it)
    const args = [
      '-p', ctx.userMessage,
      '--output-format', 'text',
      '-y',
    ];
    if (ctx.config.model) {
      args.push('-m', ctx.config.model);
    }

    return {
      cmd: 'gemini',
      args,
      env: { GEMINI_SYSTEM_PROMPT: systemPrompt },
    };
  },

  parseOutput(line: string): AgentOutputEvent | null {
    const bridge = parseBridgeLine(line);
    if (bridge) return { type: 'message', content: bridge.content };
    const dm = parseDmLine(line);
    if (dm) return { type: 'dm', toAgentId: dm.to, content: dm.content };
    const delegation = parseDelegateLine(line);
    if (delegation) return { type: 'delegate', toAgentId: delegation.to, content: delegation.content, startIfInactive: delegation.startIfInactive };
    return null;
  },
};
