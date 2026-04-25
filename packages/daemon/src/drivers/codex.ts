import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine } from '../bridge/simpleToolBridge.js';

export const codexDriver: RuntimeDriver = {
  id: 'codex',

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
    ]
      .filter(Boolean)
      .join('\n\n');

    // codex exec <prompt> -c system_prompt="..." --skip-git-repo-check
    const args = [
      'exec',
      ctx.userMessage,
      '--skip-git-repo-check',
      '-c', `system_prompt=${JSON.stringify(systemPrompt)}`,
    ];
    if (ctx.config.model) {
      args.push('-c', `model=${JSON.stringify(ctx.config.model)}`);
    }

    return { cmd: 'codex', args };
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
