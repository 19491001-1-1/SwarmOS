import { z } from 'zod';

export const RuntimeIdSchema = z.enum(['claude', 'codex', 'gemini']);

export const AgentStatusSchema = z.enum(['inactive', 'starting', 'running', 'working', 'idle', 'error']);

export const AgentActivityTypeSchema = z.enum(['thinking', 'working', 'output', 'idle', 'sending', 'error']);
export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'in_review', 'done']);
export const ReminderStatusSchema = z.enum(['pending', 'triggered', 'cancelled']);

export const AgentRuntimeConfigSchema = z.object({
  runtime: RuntimeIdSchema,
  model: z.string().optional(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  agentToken: z.string().optional(),
});

export const AgentOrganizationSchema = z.object({
  department: z.string().optional(),
  roles: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  managerId: z.string().optional(),
  backupAgentIds: z.array(z.string()).optional(),
  availability: z.enum(['available', 'unavailable', 'overloaded']).optional(),
}).partial();

export const AgentDeliverySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  senderName: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export const WorkspaceFileSchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().optional(),
  modifiedAt: z.string().optional(),
});

export const WorkspaceEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('dir'),
    path: z.string(),
    children: z.array(WorkspaceFileSchema),
  }),
  z.object({
    type: z.literal('file'),
    path: z.string(),
    content: z.string(),
    truncated: z.boolean().optional(),
    binary: z.boolean().optional(),
  }),
]);

export const WorkspaceErrorSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
  status: z.number().optional(),
});

export const TaskContextSchema = z.object({
  goal: z.string().optional(),
  background: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  sourceMessageIds: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  requesterAgentId: z.string().optional(),
  previousAgentId: z.string().optional(),
  handoffNotes: z.array(z.string()).optional(),
  privateNotes: z.array(z.string()).optional(),
}).partial();

export const TaskSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  messageId: z.string().optional(),
  title: z.string(),
  status: TaskStatusSchema,
  creatorName: z.string(),
  assigneeId: z.string().optional(),
  context: TaskContextSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ReminderSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  channelId: z.string(),
  message: z.string(),
  triggerAt: z.string(),
  status: ReminderStatusSchema,
  createdAt: z.string(),
});

export const DaemonToServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    machineId: z.string().optional(),
    hostname: z.string(),
    os: z.string(),
    daemonVersion: z.string(),
    runtimes: z.array(RuntimeIdSchema),
    runtimeVersions: z.record(z.string()),
    runningAgents: z.array(z.string()),
    capabilities: z.array(z.string()),
  }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('agent:status'),
    agentId: z.string(),
    status: AgentStatusSchema,
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:activity'),
    agentId: z.string(),
    activityType: AgentActivityTypeSchema,
    detail: z.string().optional(),
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:session'),
    agentId: z.string(),
    sessionId: z.string(),
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:dm'),
    fromAgentId: z.string(),
    toAgentId: z.string(),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('agent:delegate'),
    fromAgentId: z.string().min(1),
    toAgentId: z.string().min(1),
    content: z.string().min(1),
    startIfInactive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('agent:create_task'),
    agentId: z.string(),
    title: z.string().min(1),
    channelId: z.string().optional(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:update_task'),
    agentId: z.string(),
    taskId: z.string(),
    status: TaskStatusSchema,
  }),
  z.object({
    type: z.literal('agent:set_reminder'),
    agentId: z.string(),
    channelId: z.string().optional(),
    message: z.string().min(1),
    triggerAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('agent:cancel_reminder'),
    agentId: z.string(),
    reminderId: z.string().min(1),
  }),
  z.object({
    type: z.literal('agent:message'),
    agentId: z.string(),
    channelId: z.string(),
    content: z.string(),
    inReplyToMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:deliver:ack'),
    agentId: z.string(),
    seq: z.number(),
  }),
  z.object({
    type: z.literal('workspace:result'),
    requestId: z.string(),
    result: z.union([WorkspaceEntrySchema, WorkspaceErrorSchema]),
  }),
  z.object({
    type: z.literal('machine:runtime_models:result'),
    requestId: z.string(),
    models: z.array(z.string()).optional(),
    default: z.string().optional(),
    error: z.string().optional(),
  }),
]);

export const CreateAgentRequestSchema = z.object({
  name: z.string().min(1),
  runtime: RuntimeIdSchema,
  displayName: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  machineId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  organization: AgentOrganizationSchema.optional(),
});

export const PatchAgentRequestSchema = z
  .object({
    machineId: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    autoStart: z.boolean().optional(),
    envVars: z.record(z.string()).optional(),
    organization: AgentOrganizationSchema.optional(),
  })
  .refine(
    (val) =>
      val.machineId !== undefined ||
      val.displayName !== undefined ||
      val.description !== undefined ||
      val.model !== undefined ||
      val.systemPrompt !== undefined ||
      val.autoStart !== undefined ||
      val.envVars !== undefined ||
      val.organization !== undefined,
    { message: 'At least one field must be provided' },
  );

export const CreateMessageRequestSchema = z.object({
  senderName: z.string().min(1),
  content: z.string().min(1),
  agentId: z.string().optional(),
});

export const CreateChannelRequestSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, underscore, or dash'),
});

export const SearchRequestSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const CreateDirectMessageRequestSchema = z.object({
  content: z.string().min(1),
  fromAgentId: z.string().optional(),
});

export const CreateAgentDelegationRequestSchema = z.object({
  content: z.string().min(1),
  startIfInactive: z.boolean().optional(),
});

export const CreateTaskRequestSchema = z.object({
  channelId: z.string().min(1).default('general'),
  messageId: z.string().optional(),
  title: z.string().min(1).max(200),
  creatorName: z.string().min(1).default('user'),
  assigneeId: z.string().optional(),
  context: TaskContextSchema.optional(),
});

export const PatchTaskRequestSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    assigneeId: z.string().optional(),
    context: TaskContextSchema.optional(),
  })
  .refine((val) => val.status !== undefined || val.assigneeId !== undefined || val.context !== undefined, {
    message: 'At least one field must be provided',
  });

export const CreateReminderRequestSchema = z.object({
  channelId: z.string().min(1).default('general'),
  message: z.string().min(1),
  triggerAt: z.string().datetime(),
});

export const PatchReminderRequestSchema = z.object({
  status: z.literal('cancelled'),
});

export const MessageToTaskRequestSchema = z.object({
  assigneeId: z.string().optional(),
  creatorName: z.string().min(1).default('user'),
  context: TaskContextSchema.optional(),
});

export const InternalMessageSendRequestSchema = z.object({
  channel: z.string().min(1).default('general'),
  content: z.string().min(1),
});

export const InternalMessageReadRequestSchema = z.object({
  channel: z.string().min(1).default('general'),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

export const InternalDmSendRequestSchema = z.object({
  to: z.string().min(1),
  content: z.string().min(1),
});

export const InternalAgentDelegateRequestSchema = z.object({
  to: z.string().min(1),
  content: z.string().min(1),
  startIfInactive: z.boolean().optional(),
});

export const InternalAgentResolveRequestSchema = z.object({
  query: z.string().min(1),
});

export const InternalTaskListRequestSchema = z.object({
  channel: z.string().min(1).optional(),
  status: TaskStatusSchema.optional(),
  all: z.preprocess((value) => {
    if (value === undefined) return false;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  }, z.boolean()).default(false),
});

export const InternalTaskUpdateRequestSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    assigneeId: z.string().optional(),
    context: TaskContextSchema.optional(),
  })
  .refine((val) => val.status !== undefined || val.assigneeId !== undefined || val.context !== undefined, {
    message: 'At least one field must be provided',
  });

export const InternalTaskHandoffRequestSchema = z.object({
  to: z.string().min(1),
  notes: z.string().min(1),
  goal: z.string().optional(),
  nextStep: z.string().optional(),
});

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type PatchAgentRequest = z.infer<typeof PatchAgentRequestSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateDirectMessageRequest = z.infer<typeof CreateDirectMessageRequestSchema>;
export type CreateAgentDelegationRequest = z.infer<typeof CreateAgentDelegationRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type PatchTaskRequest = z.infer<typeof PatchTaskRequestSchema>;
export type MessageToTaskRequest = z.infer<typeof MessageToTaskRequestSchema>;
export type TaskContextRequest = z.infer<typeof TaskContextSchema>;
export type InternalMessageSendRequest = z.infer<typeof InternalMessageSendRequestSchema>;
export type InternalMessageReadRequest = z.infer<typeof InternalMessageReadRequestSchema>;
export type InternalDmSendRequest = z.infer<typeof InternalDmSendRequestSchema>;
export type InternalAgentDelegateRequest = z.infer<typeof InternalAgentDelegateRequestSchema>;
export type InternalAgentResolveRequest = z.infer<typeof InternalAgentResolveRequestSchema>;
export type InternalTaskListRequest = z.infer<typeof InternalTaskListRequestSchema>;
export type InternalTaskUpdateRequest = z.infer<typeof InternalTaskUpdateRequestSchema>;
export type InternalTaskHandoffRequest = z.infer<typeof InternalTaskHandoffRequestSchema>;

export const ServerToDaemonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('agent:start'),
    agentId: z.string(),
    config: AgentRuntimeConfigSchema,
    launchId: z.string(),
    wakeMessage: AgentDeliverySchema.optional(),
  }),
  z.object({ type: z.literal('agent:stop'), agentId: z.string() }),
  z.object({
    type: z.literal('agent:deliver'),
    agentId: z.string(),
    seq: z.number(),
    message: AgentDeliverySchema,
    config: AgentRuntimeConfigSchema.optional(),
    channelId: z.string().optional(),
  }),
  z.object({ type: z.literal('agent:reset-workspace'), agentId: z.string() }),
  z.object({
    type: z.literal('workspace:read'),
    agentId: z.string(),
    requestId: z.string(),
    relPath: z.string(),
  }),
  z.object({
    type: z.literal('machine:runtime_models:detect'),
    runtime: RuntimeIdSchema,
    requestId: z.string(),
  }),
]);
