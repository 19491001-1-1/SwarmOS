import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine, buildTaskInstruction, buildMemoryInstruction, parseCreateTaskLine, parseUpdateTaskLine, buildReminderInstruction, parseReminderLine, parseCancelReminderLine } from '../bridge/simpleToolBridge.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

export const geminiDriver: RuntimeDriver = {
  id: 'gemini',
  capabilities: {
    transport: 'mcp',
    supportsStdinDelivery: false,
    busyDeliveryMode: 'inbox',
    supportsSessionResume: false,
    supportsMcpBridge: true,
  },

  async prepareWorkspace(ctx: AgentSpawnContext): Promise<void> {
    const geminiDir = join(ctx.workspaceDir, '.gemini');
    await mkdir(geminiDir, { recursive: true });
    await writeFile(join(geminiDir, 'settings.json'), JSON.stringify({
      mcpServers: {
        chat: {
          command: join(ctx.workspaceDir, '.crewden', 'crewden'),
          args: [
            'mcp-bridge',
            '--agent-id', ctx.agentId,
            '--server-url', ctx.serverUrl,
            '--auth-token-file', ctx.agentTokenFile,
          ],
        },
      },
    }, null, 2));
  },

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    const systemPrompt = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
      buildTaskInstruction(),
      buildReminderInstruction(),
      buildMemoryInstruction(),
    ]
      .filter(Boolean)
      .join('\n\n');

    // gemini -p "<prompt>" --output-format text --approval-mode yolo
    // system prompt via GEMINI_SYSTEM_PROMPT env var (gemini CLI reads it)
    const args = [
      '-p', ctx.formattedMessage || ctx.userMessage,
      '--output-format', 'text',
      '--sandbox', 'false',
      '--approval-mode', 'yolo',
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
    const createTask = parseCreateTaskLine(line);
    if (createTask) return { type: 'create_task', title: createTask.title, assigneeId: createTask.assignee, channelId: createTask.channel };
    const updateTask = parseUpdateTaskLine(line);
    if (updateTask) return { type: 'update_task', taskId: updateTask.taskId, status: updateTask.status };
    const reminder = parseReminderLine(line);
    if (reminder) return { type: 'set_reminder', channelId: reminder.channelId, message: reminder.message, triggerAt: reminder.triggerAt };
    const cancelReminder = parseCancelReminderLine(line);
    if (cancelReminder) return { type: 'cancel_reminder', reminderId: cancelReminder.reminderId };
    return null;
  },
};
