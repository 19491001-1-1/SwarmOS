import type { RuntimeId, AgentRuntimeConfig, TaskStatus } from '@mini-slock/shared';

export type AgentSpawnContext = {
  agentId: string;
  config: AgentRuntimeConfig;
  workspaceDir: string;
  transcriptFile: string;
  userMessage: string;
};

export type RuntimeCommand = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
};

export type AgentOutputEvent =
  | { type: 'message'; content: string }
  | { type: 'dm'; toAgentId: string; content: string }
  | { type: 'delegate'; toAgentId: string; content: string; startIfInactive?: boolean }
  | { type: 'create_task'; title: string; assigneeId?: string; channelId?: string }
  | { type: 'update_task'; taskId: string; status: TaskStatus }
  | { type: 'activity'; detail: string };

export interface RuntimeDriver {
  id: RuntimeId;
  detectModels?(): Promise<{ models: string[]; default?: string }>;
  buildCommand(ctx: AgentSpawnContext): RuntimeCommand;
  parseOutput?(line: string): AgentOutputEvent | null;
}
