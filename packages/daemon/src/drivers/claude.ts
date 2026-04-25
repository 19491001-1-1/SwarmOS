import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine, buildTaskInstruction, parseCreateTaskLine, parseUpdateTaskLine } from '../bridge/simpleToolBridge.js';

export const claudeDriver: RuntimeDriver = {
  id: 'claude',

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
      buildTaskInstruction(),
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
    const dm = parseDmLine(line);
    if (dm) return { type: 'dm', toAgentId: dm.to, content: dm.content };
    const delegation = parseDelegateLine(line);
    if (delegation) return { type: 'delegate', toAgentId: delegation.to, content: delegation.content, startIfInactive: delegation.startIfInactive };
    const createTask = parseCreateTaskLine(line);
    if (createTask) return { type: 'create_task', title: createTask.title, assigneeId: createTask.assignee, channelId: createTask.channel };
    const updateTask = parseUpdateTaskLine(line);
    if (updateTask) return { type: 'update_task', taskId: updateTask.taskId, status: updateTask.status };
    return null;
  },
};
