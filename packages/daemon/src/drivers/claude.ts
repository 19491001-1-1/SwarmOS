import type { RuntimeDriver, AgentSpawnContext, RuntimeCommand, AgentOutputEvent } from './types.js';
import { parseBridgeLine, buildBridgeInstruction, buildDmInstruction, parseDmLine, buildDelegateInstruction, parseDelegateLine, buildTaskInstruction, buildMemoryInstruction, buildCommunicationInstruction, parseCreateTaskLine, parseUpdateTaskLine, buildReminderInstruction, parseReminderLine, parseCancelReminderLine, parseCliActionLine } from '../bridge/simpleToolBridge.js';

// MCP bridge tools that already deliver a message via HTTP; subsequent agent text must not be re-forwarded.
const MCP_SEND_TOOLS = new Set([
  'mcp__crewden__send_message',
  'mcp__crewden__send_dm',
  'mcp__crewden__delegate_agent',
]);
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';

function getAgentCliPath(): string {
  const driverDir = dirname(fileURLToPath(import.meta.url));
  const srcDir = dirname(driverDir);
  const packageDir = dirname(srcDir);
  return driverDir.endsWith(`${sep}drivers`)
    ? join(packageDir, 'dist', 'agentCli.js')
    : join(driverDir, 'agentCli.js');
}

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
    await writeFile(join(claudeDir, 'crewden-mcp.json'), JSON.stringify({
      mcpServers: {
        crewden: {
          command: process.execPath,
          args: [
            getAgentCliPath(),
            'mcp-bridge',
            '--agent-id', ctx.agentId,
            '--server-url', ctx.serverUrl,
            '--auth-token-file', ctx.agentTokenFile,
          ],
        },
      },
    }, null, 2));

    // Write bridge instructions to CLAUDE.md so they are read from file
    // instead of passed via --append-system-prompt (which exceeds the Windows
    // command-line length limit of 8191 chars).
    const instructions = [
      ctx.config.systemPrompt ?? '',
      buildBridgeInstruction(),
      buildDmInstruction(),
      buildDelegateInstruction(),
      buildTaskInstruction(),
      buildReminderInstruction(),
      buildMemoryInstruction(),
      buildCommunicationInstruction(),
    ].filter(Boolean).join('\n\n');
    if (instructions) {
      await writeFile(join(claudeDir, 'CLAUDE.md'), instructions);
    }
  },

  buildCommand(ctx: AgentSpawnContext): RuntimeCommand {
    // Bridge instructions are written to .claude/CLAUDE.md in prepareWorkspace
    // to avoid exceeding the Windows command-line length limit (8191 chars).
    const args = [
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--mcp-config', join(ctx.workspaceDir, '.claude', 'crewden-mcp.json'),
    ];
    if (ctx.config.systemPrompt) {
      args.push('--append-system-prompt', ctx.config.systemPrompt);
    }
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
    const cliAction = parseCliActionLine(line);
    if (cliAction) return { type: 'external_action', command: cliAction.command };
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
        if (toolUse) {
          const name: string = toolUse.name ?? '';
          if (MCP_SEND_TOOLS.has(name)) return { type: 'mcp_bridge_send', tool: name };
          return { type: 'activity', detail: `tool:${name || 'unknown_tool'}` };
        }
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
