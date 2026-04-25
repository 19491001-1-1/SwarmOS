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

    const prompt = [
      systemPrompt,
      'Current user message:',
      ctx.userMessage,
    ].join('\n\n');

    // codex exec does not expose a stable system prompt flag, so put bridge rules in the prompt.
    const args = [
      'exec',
      prompt,
      '--skip-git-repo-check',
      '--sandbox', 'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
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
