import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction } from '../bridge/simpleToolBridge.js';

export const claudeDriver: RuntimeDriver = {
  id: 'claude',

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
    ]
      .filter(Boolean)
      .join('\n\n');

    // prompt is passed as the positional argument; system prompt via --system-prompt
    const args = [
      '-p', ctx.userMessage,
      '--system-prompt', systemPrompt,
      '--output-format', 'text',
      '--dangerously-skip-permissions',
    ];
    if (ctx.config.model) {
      args.push('--model', ctx.config.model);
    }

    return { cmd: 'claude', args };
  },

  parseOutput(line: string): AgentOutputEvent | null {
    const bridge = parseBridgeLine(line);
    if (bridge) return { type: 'message', content: bridge.content };
    return null;
  },
};
