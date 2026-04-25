import type { RuntimeId, AgentRuntimeConfig, TaskStatus } from '@mini-slock/shared';

export type RuntimeTransport = 'oneshot' | 'stream-json' | 'app-server' | 'mcp';

export type BusyDeliveryMode = 'best-effort-direct' | 'notification' | 'inbox';

export type RuntimeCapabilities = {
  transport: RuntimeTransport;
  supportsStdinDelivery: boolean;
  busyDeliveryMode: BusyDeliveryMode;
  supportsSessionResume: boolean;
  supportsMcpBridge: boolean;
};

export type PromptContextBlock = {
  id: string;
  title: string;
  content: string;
};

export type AgentSpawnContext = {
  agentId: string;
  config: AgentRuntimeConfig;
  workspaceDir: string;
  transcriptFile: string;
  userMessage: string;
  formattedMessage: string;
  sessionId?: string;
  serverUrl: string;
  agentTokenFile: string;
  unreadSummary?: {
    queuedCount: number;
    newestMessageAt?: string;
  };
  contextBlocks?: PromptContextBlock[];
};

export type RuntimeCommand = {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
};

export type AgentOutputEvent =
  | { type: 'message'; content: string }
  | { type: 'dm'; toAgentId: string; content: string }
  | { type: 'delegate'; toAgentId: string; content: string; startIfInactive?: boolean }
  | { type: 'create_task'; title: string; assigneeId?: string; channelId?: string }
  | { type: 'update_task'; taskId: string; status: TaskStatus }
  | { type: 'activity'; detail: string }
  | { type: 'session_init'; sessionId: string }
  | { type: 'turn_end'; sessionId?: string };

export interface RuntimeDriver {
  id: RuntimeId;
  capabilities: RuntimeCapabilities;
  detectModels?(): Promise<{ models: string[]; default?: string }>;
  buildCommand(ctx: AgentSpawnContext): RuntimeCommand;
  prepareWorkspace?(ctx: AgentSpawnContext): Promise<void>;
  encodeStdinMessage?(text: string, sessionId?: string): string;
  parseOutput?(line: string): AgentOutputEvent | null;
}
