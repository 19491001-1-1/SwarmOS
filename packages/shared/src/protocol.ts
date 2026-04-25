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

export type AgentDelivery = {
  id: string;
  channelId: string;
  channelName: string;
  senderName: string;
  content: string;
  createdAt: string;
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
  | { type: 'agent:message'; agentId: string; channelId: string; content: string; inReplyToMessageId?: string }
  | { type: 'agent:deliver:ack'; agentId: string; seq: number }
  | { type: 'machine:runtime_models:result'; requestId: string; models?: string[]; default?: string; error?: string };

export type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery; config?: AgentRuntimeConfig; channelId?: string }
  | { type: 'agent:reset-workspace'; agentId: string }
  | { type: 'machine:runtime_models:detect'; runtime: RuntimeId; requestId: string };

export type Message = {
  id: string;
  channelId: string;
  agentId?: string;
  senderName: string;
  content: string;
  createdAt: string;
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
  machineId?: string;
  status: AgentStatus;
  createdAt: string;
};

export type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'agent:updated'; agent: Agent }
  | { type: 'agent:activity'; agentId: string; activity: AgentActivity }
  | { type: 'dm:new'; dm: DirectMessage }
  | { type: 'agent:delegation'; delegation: AgentDelegation }
  | { type: 'machine:update'; machine: Machine };
