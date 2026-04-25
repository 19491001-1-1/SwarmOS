import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine, buildTaskInstruction, buildMemoryInstruction, parseCreateTaskLine, parseUpdateTaskLine, buildReminderInstruction, parseReminderLine, parseCancelReminderLine } from '../bridge/simpleToolBridge.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

export const claudeDriver: RuntimeDriver = {
  id: 'claude',
  capabilities: {
    transport: 'stream-json',
    supportsStdinDelivery: true,
    busyDeliveryMode: 'notification',
    supportsSessionResume: true,
    supportsMcpBridge: true,
  },

  async prepareWorkspace(ctx: AgentSpawnContext): Promise<void> {
    const claudeDir = join(ctx.workspaceDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'xoxiang-mcp.json'), JSON.stringify({
      mcpServers: {
        xoxiang: {
          command: join(ctx.workspaceDir, '.xoxiang', 'xoxiang'),
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

    const args = [
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--mcp-config', join(ctx.workspaceDir, '.claude', 'xoxiang-mcp.json'),
      '--append-system-prompt', systemPrompt,
    ];
    if (ctx.config.model) {
      args.push('--model', ctx.config.model);
    }
    if (ctx.sessionId) {
      args.push('--resume', ctx.sessionId);
    }

    return {
      cmd: 'claude',
      args,
      stdin: this.encodeStdinMessage?.(ctx.formattedMessage || ctx.userMessage, ctx.sessionId),
    };
  },

  encodeStdinMessage(text: string, sessionId?: string): string {
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
      ...(sessionId ? { session_id: sessionId } : {}),
    });
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
    try {
      const event = JSON.parse(line) as any;
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        return { type: 'session_init', sessionId: String(event.session_id) };
      }
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        const text = event.message.content
          .filter((block: any) => block?.type === 'text' && block.text)
          .map((block: any) => String(block.text))
          .join('\n')
          .trim();
        if (text) return { type: 'message', content: text };
        const toolUse = event.message.content.find((block: any) => block?.type === 'tool_use');
        if (toolUse) return { type: 'activity', detail: `tool:${toolUse.name ?? 'unknown_tool'}` };
      }
      if (event.type === 'result') {
        return { type: 'turn_end', sessionId: event.session_id ? String(event.session_id) : undefined };
      }
    } catch {
      // Non-JSON lines are normal when verbose logging is enabled.
    }
    return null;
  },
};
