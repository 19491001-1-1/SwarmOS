/** SwarmOS shared protocol layer — Zod schemas for type-safe cross-package contracts */
import { z } from "zod";

// Protocol meta
export const ProtocolMeta = z.object({
  protocol_version: z.string(),
});

// Agent config used in swarm/init
export const AgentConfigSchema = z.object({
  agent_id: z.string(),
  role: z.string().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
});

export const SwarmInitRequestSchema = z.object({
  protocol_version: z.string(),
  channel_id: z.string(),
  agents: z.array(AgentConfigSchema),
});

export const SwarmInitResponseSchema = z.object({
  protocol_version: z.string(),
  swarm_id: z.string(),
  channel_id: z.string(),
  agent_count: z.number().int(),
  status: z.enum(["initialized", "running", "failed", "partial"]),
});

// Thought log event
export const ThoughtLogEventSchema = z.object({
  event_id: z.string(),
  swarm_id: z.string().optional(),
  agent_id: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.literal("thought_log"),
  message: z.string(),
  detail: z.any().optional(),
  severity: z.enum(["debug", "info", "warn", "error"]).optional(),
});

// Approval models
export const ApprovalRequestSchema = z.object({
  approval_id: z.string(),
  action_id: z.string().optional(),
  swarm_id: z.string().optional(),
  agent_id: z.string().optional(),
  reason: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  created_at: z.string().optional(),
});

export const ApprovalDecisionSchema = z.object({
  approval_id: z.string(),
  approved: z.boolean(),
  reviewer: z.string().optional(),
  comment: z.string().optional(),
  decided_at: z.string().optional(),
});

export const ApprovalRecordSchema = z.object({
  id: z.string(),
  actionId: z.string().optional(),
  swarmId: z.string().optional(),
  agentId: z.string().optional(),
  reason: z.string().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewer: z.string().optional(),
  comment: z.string().optional(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
});

// Action / daemon models
export const DaemonActionRequestSchema = z.object({
  action_id: z.string(),
  agent_id: z.string(),
  tool: z.string(),
  target_path: z.string().optional(),
  params: z.record(z.any()).optional(),
  created_at: z.string().optional(),
});

export const ActionStatus = z.enum([
  "planned",
  "waiting_lock",
  "risk_detected",
  "awaiting_approval",
  "approved",
  "rejected",
  "running",
  "timed_out",
  "success",
  "error",
  "cancelled",
]);

export const DaemonActionResultSchema = z.object({
  action_id: z.string(),
  status: ActionStatus,
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error_type: z.string().optional(),
  timestamp: z.string().optional(),
  lock_owner: z.string().optional(),
  approval_id: z.string().optional(),
});

export const LockStatusSchema = z.object({
  path: z.string(),
  state: z.enum(["unlocked", "locked", "released"]),
  owner: z.string().optional(),
  since: z.string().optional(),
});

export const TimeoutErrorPayloadSchema = z.object({
  action_id: z.string(),
  timeout_seconds: z.number().int(),
  killed: z.boolean(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

export const RiskLevel = z.enum(["low", "medium", "high"]);

// Exports for types
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SwarmInitRequest = z.infer<typeof SwarmInitRequestSchema>;
export type SwarmInitResponse = z.infer<typeof SwarmInitResponseSchema>;
export type ThoughtLogEvent = z.infer<typeof ThoughtLogEventSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type DaemonActionRequest = z.infer<typeof DaemonActionRequestSchema>;
export type DaemonActionResult = z.infer<typeof DaemonActionResultSchema>;
export type LockStatus = z.infer<typeof LockStatusSchema>;
export type TimeoutErrorPayload = z.infer<typeof TimeoutErrorPayloadSchema>;

// Example messages
export const ExampleSwarmInitRequest = {
  protocol_version: "v1.0.0",
  channel_id: "c_9901",
  agents: [
    {
      agent_id: "coder_main",
      role: "Senior Developer",
      model: "local-exec",
      system_prompt: "你负责处理具体的代码修改...",
      allowed_tools: ["file_read", "file_write", "exec_cmd"],
    },
  ],
};
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
  autoWork?: {
    enabled?: boolean;
    intervalMs?: number;
    maxClaimableTasksPerRun?: number;
  };
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

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled';
export type GoalBriefStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed';
export type GoalAlignmentStatus = 'needs_clarification' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';
export type GoalAlignmentRiskLevel = 'low' | 'medium' | 'high';
export type WorkItemKind = 'mention' | 'dm' | 'assigned_task' | 'claimable_task' | 'reminder' | 'review_request' | 'blocked_escalation';
export type WorkItemPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskProgressEventType = 'claimed' | 'started' | 'heartbeat' | 'blocked' | 'handoff' | 'completed' | 'escalated';
export type ReviewStatus = 'requested' | 'changes_requested' | 'approved' | 'cancelled';
export type KnowledgeKind = 'decision' | 'project_archive' | 'user_preference' | 'runbook' | 'learning' | 'artifact';
export type KnowledgeStatus = 'active' | 'stale' | 'conflict' | 'archived';

export type AgentInboxItem = {
  id: string;
  kind: WorkItemKind;
  agentId: string;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  goalId?: string;
  priority: WorkItemPriority;
  summary: string;
  dueAt?: string;
  createdAt: string;
};

export type TaskProgressEvent = {
  id: string;
  taskId: string;
  agentId: string;
  type: TaskProgressEventType;
  detail: string;
  createdAt: string;
};

export type TaskReview = {
  id: string;
  taskId: string;
  requesterAgentId?: string;
  reviewerAgentId?: string;
  status: ReviewStatus;
  evidence: string[];
  checklist: Array<{ label: string; checked: boolean }>;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEntry = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sourceRefs: string[];
  ownerAgentId?: string;
  reviewerAgentId?: string;
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSearchResult = {
  entry: KnowledgeEntry;
  score?: number;
  reason?: string;
};

export type KnowledgeAdapter = {
  id: string;
  name: string;
  search(query: string, options?: { tags?: string[]; kind?: KnowledgeKind }): Promise<KnowledgeSearchResult[]>;
  read(id: string): Promise<KnowledgeEntry | undefined>;
  write(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  update(id: string, patch: Partial<KnowledgeEntry>): Promise<KnowledgeEntry>;
};

export type GoalBrief = {
  id: string;
  channelId: string;
  sourceMessageId?: string;
  requesterName: string;
  objective: string;
  background: string[];
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
  risks: string[];
  status: GoalBriefStatus;
  createdAt: string;
  updatedAt: string;
};

export type GoalTaskDraft = {
  title: string;
  assigneeId?: string;
  dependencies?: string[];
  acceptanceCriteria?: string[];
  artifacts?: string[];
};

export type GoalAlignmentTaskDraft = GoalTaskDraft & {
  role?: 'owner' | 'reviewer' | 'support';
};

export type GoalAlignment = {
  id: string;
  channelId: string;
  threadRootId: string;
  sourceMessageId: string;
  goalId?: string;
  status: GoalAlignmentStatus;
  objective: string;
  questions: string[];
  answers: string[];
  successCriteria: string[];
  constraints: string[];
  planSummary?: string;
  taskDrafts: GoalAlignmentTaskDraft[];
  recommendedAgentIds: string[];
  reviewerAgentIds: string[];
  recommendationReasons: Record<string, string>;
  gaps: string[];
  riskLevel: GoalAlignmentRiskLevel;
  createdAt: string;
  updatedAt: string;
};

export type TaskContext = {
  goalId?: string;
  goalObjective?: string;
  goal?: string;
  background?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  assumptions?: string[];
  risks?: string[];
  dependencies?: string[];
  blockedByTaskIds?: string[];
  sourceMessageIds?: string[];
  artifacts?: string[];
  requesterAgentId?: string;
  previousAgentId?: string;
  handoffNotes?: string[];
  privateNotes?: string[];
  claimedByAgentId?: string;
  blockedReason?: string;
  blockedNeeds?: string;
  escalatedReason?: string;
  progressEvents?: TaskProgressEvent[];
  reviewerAgentId?: string;
  evidence?: string[];
  acceptanceChecklist?: string[];
  reviewIds?: string[];
  reviewNotes?: string[];
  reviews?: TaskReview[];
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
  version: number;
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
  threadRootId?: string;
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

export type DaemonActionUpdate = {
  action_id: string;
  status: DaemonActionResult['status'];
  stdout?: string;
  stderr?: string;
  error_type?: string;
  timestamp?: string;
  lock_owner?: string;
  approval_id?: string;
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
  | { type: 'machine:runtime_models:result'; requestId: string; models?: string[]; default?: string; error?: string }
  | { type: 'lock:update'; path: string; state: 'locked' | 'released'; agentId: string; since?: string }
  | { type: 'daemon:action:update'; agentId: string; action: DaemonActionUpdate };

export type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'approval:requested'; approval: ApprovalRecord }
  | { type: 'approval:resolved'; approval: ApprovalRecord }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery; inboxSummary?: string }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery; config?: AgentRuntimeConfig; channelId?: string; inboxSummary?: string }
  | { type: 'agent:reset-workspace'; agentId: string }
  | { type: 'workspace:read'; agentId: string; requestId: string; relPath: string }
  | { type: 'machine:runtime_models:detect'; runtime: RuntimeId; requestId: string }
  | { type: 'action:execute'; agentId: string; action: DaemonActionRequest };

export type Message = {
  id: string;
  channelId: string;
  agentId?: string;
  senderName: string;
  content: string;
  threadRootId?: string;
  replyCount?: number;
  latestReplyAt?: string;
  mentions?: Mention[];
  createdAt: string;
};

export type Mention = {
  type: 'agent' | 'user';
  id: string;
  label: string;
};

export type MessageThread = {
  root: Message;
  replies: Message[];
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
    workingStyle?: string;
    handoffPreference?: string;
    examples?: string[];
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
  | { type: 'thread:message:new'; root: Message; message: Message }
  | { type: 'channel:created'; channel: Channel }
  | { type: 'channel:deleted'; channelId: string }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'agent:updated'; agent: Agent }
  | { type: 'agent:deleted'; agentId: string }
  | { type: 'agent:activity'; agentId: string; activity: AgentActivity }
  | { type: 'dm:new'; dm: DirectMessage }
  | { type: 'agent:delegation'; delegation: AgentDelegation }
  | { type: 'approval:requested'; approval: ApprovalRecord }
  | { type: 'approval:resolved'; approval: ApprovalRecord }
  | { type: 'goal:update'; goal: GoalBrief }
  | { type: 'goal-alignment:update'; alignment: GoalAlignment }
  | { type: 'knowledge:update'; entry: KnowledgeEntry }
  | { type: 'task:update'; task: Task }
  | { type: 'reminder:update'; reminder: Reminder }
  | { type: 'machine:update'; machine: Machine }
  | { type: 'lock:update'; path: string; state: 'locked' | 'released'; agentId: string; since?: string }
  | { type: 'thought_log'; event: ThoughtLogEvent }
  | { type: 'daemon:action:update'; agentId: string; action: DaemonActionUpdate };
