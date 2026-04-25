import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine, buildTaskInstruction, buildMemoryInstruction, parseCreateTaskLine, parseUpdateTaskLine } from '../bridge/simpleToolBridge.js';

export const codexDriver: RuntimeDriver = {
  id: 'codex',
  capabilities: {
    transport: 'oneshot',
    supportsStdinDelivery: false,
    busyDeliveryMode: 'inbox',
    supportsSessionResume: false,
    supportsMcpBridge: false,
  },

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
      buildTaskInstruction(),
      buildMemoryInstruction(),
    ]
      .filter(Boolean)
      .join('\n\n');

    const prompt = [
      systemPrompt,
      'Current user message:',
      ctx.formattedMessage || ctx.userMessage,
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
    const createTask = parseCreateTaskLine(line);
    if (createTask) return { type: 'create_task', title: createTask.title, assigneeId: createTask.assignee, channelId: createTask.channel };
    const updateTask = parseUpdateTaskLine(line);
    if (updateTask) return { type: 'update_task', taskId: updateTask.taskId, status: updateTask.status };
    return null;
  },
};
