import type { VersionInfo } from './version.js';

export type RuntimeId = 'claude' | 'codex' | 'gemini';

export type AgentStatus = 'inactive' | 'starting' | 'running' | 'working' | 'idle' | 'error';

export type AgentActivity = {
  id: string;
  agentId: string;
  type: 'thinking' | 'working' | 'output' | 'idle' | 'sending' | 'error';
  detail?: string;
  createdAt: string;
};

export type AgentRuntimeConfig = {
  runtime: RuntimeId;
  model?: string;
  name: string;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  agentToken?: string;
};

export type DirectMessage = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  createdAt: string;
};

export type DirectMessageThread = {
  otherAgentId: string;
  lastMessage: DirectMessage;
};

export type AgentDelegation = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  status: 'queued' | 'delivered' | 'started' | 'failed';
  error?: string;
  createdAt: string;
};

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export type TaskContext = {
  goal?: string;
  background?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  sourceMessageIds?: string[];
  artifacts?: string[];
  requesterAgentId?: string;
  previousAgentId?: string;
  handoffNotes?: string[];
  privateNotes?: string[];
};

export type Task = {
  id: string;
  channelId: string;
  messageId?: string;
  title: string;
  status: TaskStatus;
  creatorName: string;
  assigneeId?: string;
  context?: TaskContext;
  createdAt: string;
  updatedAt: string;
};

export type ReminderStatus = 'pending' | 'triggered' | 'cancelled';

export type Reminder = {
  id: string;
  agentId: string;
  channelId: string;
  message: string;
  triggerAt: string;
  status: ReminderStatus;
  createdAt: string;
};

export type AgentTokenInfo = {
  agentId: string;
  token: string;
  createdAt: string;
};

export type AgentWhoami = {
  agent: Agent;
};

export type AgentResolveResult = {
  query: string;
  match?: Agent;
  confidence?: 'exact_id' | 'exact_name' | 'exact_display_name' | 'case_insensitive_name' | 'case_insensitive_display_name' | 'description_hint';
  candidates: Agent[];
};

export type AgentServerInfo = {
  agent: Agent;
  channels: Channel[];
  agents: Agent[];
  version: VersionInfo;
};

export type AgentUnreadSummary = {
  channels: Array<{ channelId: string; channelName: string; count: number; latestMessage?: Message }>;
  dms: Array<{ otherAgentId: string; count: number; latestMessage?: DirectMessage }>;
};

export type AgentDelivery = {
  id: string;
  channelId: string;
  channelName: string;
  senderName: string;
  content: string;
  createdAt: string;
};

export type WorkspaceFile = {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: string;
};

export type WorkspaceEntry =
  | { type: 'dir'; path: string; children: WorkspaceFile[] }
  | { type: 'file'; path: string; content: string; truncated?: boolean; binary?: boolean };

export type WorkspaceError = {
  type: 'error';
  error: string;
  status?: number;
};

export type DaemonToServer =
  | {
      type: 'ready';
      machineId?: string;
      hostname: string;
      os: string;
      daemonVersion: string;
      runtimes: RuntimeId[];
      runtimeVersions: Record<string, string>;
      runningAgents: string[];
      capabilities: string[];
    }
  | { type: 'pong' }
  | { type: 'agent:status'; agentId: string; status: AgentStatus; launchId?: string }
  | { type: 'agent:activity'; agentId: string; activityType: AgentActivity['type']; detail?: string; launchId?: string }
  | { type: 'agent:session'; agentId: string; sessionId: string; launchId?: string }
  | { type: 'agent:dm'; fromAgentId: string; toAgentId: string; content: string }
  | { type: 'agent:delegate'; fromAgentId: string; toAgentId: string; content: string; startIfInactive?: boolean }
  | { type: 'agent:create_task'; agentId: string; title: string; channelId?: string; assigneeId?: string }
  | { type: 'agent:update_task'; agentId: string; taskId: string; status: TaskStatus }
  | { type: 'agent:set_reminder'; agentId: string; channelId?: string; message: string; triggerAt: string }
  | { type: 'agent:cancel_reminder'; agentId: string; reminderId: string }
  | { type: 'agent:message'; agentId: string; channelId: string; content: string; inReplyToMessageId?: string }
  | { type: 'agent:deliver:ack'; agentId: string; seq: number }
  | { type: 'workspace:result'; requestId: string; result: WorkspaceEntry | WorkspaceError }
  | { type: 'machine:runtime_models:result'; requestId: string; models?: string[]; default?: string; error?: string };

export type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery; config?: AgentRuntimeConfig; channelId?: string }
  | { type: 'agent:reset-workspace'; agentId: string }
  | { type: 'workspace:read'; agentId: string; requestId: string; relPath: string }
  | { type: 'machine:runtime_models:detect'; runtime: RuntimeId; requestId: string };

export type Message = {
  id: string;
  channelId: string;
  agentId?: string;
  senderName: string;
  content: string;
  createdAt: string;
};

export type SearchMessageResult = Message & {
  channelName: string;
};

export type Channel = {
  id: string;
  name: string;
  createdAt: string;
};

export type Machine = {
  id: string;
  hostname: string;
  os: string;
  daemonVersion: string;
  runtimes: RuntimeId[];
  runtimeVersions: Record<string, string>;
  status: 'online' | 'offline';
  connectedAt: string;
};

export type Agent = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  runtime: RuntimeId;
  model?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  organization?: {
    department?: string;
    roles?: string[];
    capabilities?: string[];
    responsibilities?: string[];
    managerId?: string;
    backupAgentIds?: string[];
    availability?: 'available' | 'unavailable' | 'overloaded';
  };
  machineId?: string;
  status: AgentStatus;
  autoStart?: boolean;
  createdAt: string;
};

export type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'channel:created'; channel: Channel }
  | { type: 'channel:deleted'; channelId: string }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'agent:updated'; agent: Agent }
  | { type: 'agent:activity'; agentId: string; activity: AgentActivity }
  | { type: 'dm:new'; dm: DirectMessage }
  | { type: 'agent:delegation'; delegation: AgentDelegation }
  | { type: 'task:update'; task: Task }
  | { type: 'reminder:update'; reminder: Reminder }
  | { type: 'machine:update'; machine: Machine };
