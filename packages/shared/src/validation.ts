import { z } from 'zod';

export const RuntimeIdSchema = z.enum(['claude', 'codex', 'gemini']);

export const AgentStatusSchema = z.enum(['inactive', 'starting', 'running', 'working', 'idle', 'error']);

export const AgentActivityTypeSchema = z.enum(['thinking', 'working', 'output', 'idle', 'sending', 'error']);

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
  }),
]);

export const WorkspaceErrorSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
  status: z.number().optional(),
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
  })
  .refine(
    (val) =>
      val.machineId !== undefined ||
      val.displayName !== undefined ||
      val.description !== undefined ||
      val.model !== undefined ||
      val.systemPrompt !== undefined ||
      val.autoStart !== undefined ||
      val.envVars !== undefined,
    { message: 'At least one field must be provided' },
  );

export const CreateMessageRequestSchema = z.object({
  senderName: z.string().min(1),
  content: z.string().min(1),
  agentId: z.string().optional(),
});

export const CreateDirectMessageRequestSchema = z.object({
  content: z.string().min(1),
  fromAgentId: z.string().optional(),
});

export const CreateAgentDelegationRequestSchema = z.object({
  content: z.string().min(1),
  startIfInactive: z.boolean().optional(),
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

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type PatchAgentRequest = z.infer<typeof PatchAgentRequestSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateDirectMessageRequest = z.infer<typeof CreateDirectMessageRequestSchema>;
export type CreateAgentDelegationRequest = z.infer<typeof CreateAgentDelegationRequestSchema>;
export type InternalMessageSendRequest = z.infer<typeof InternalMessageSendRequestSchema>;
export type InternalMessageReadRequest = z.infer<typeof InternalMessageReadRequestSchema>;
export type InternalDmSendRequest = z.infer<typeof InternalDmSendRequestSchema>;
export type InternalAgentDelegateRequest = z.infer<typeof InternalAgentDelegateRequestSchema>;

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
