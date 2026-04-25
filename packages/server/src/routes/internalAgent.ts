import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import {
  createVersionInfo,
  ConfirmGoalAlignmentRequestSchema,
  CreateReminderRequestSchema,
  InternalGoalCreateRequestSchema,
  InternalGoalCreateTasksRequestSchema,
  InternalGoalListRequestSchema,
  InternalGoalAlignRequestSchema,
  InternalGoalAlignmentPatchRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalDmSendRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskUpdateRequestSchema,
  PatchReminderRequestSchema,
  type GoalAlignment,
  type Agent,
  type DirectMessage,
} from '@mini-slock/shared';
import { buildClarifyingQuestions, inferGoalRiskLevel, recommendAgentsForGoal, toRuntimeConfig } from '@mini-slock/hub-core';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { delegateAgent } from '../delegation.js';
import { notifyTaskAssignee } from '../taskDelivery.js';

export async function internalAgentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/agent/')) return;
    const agentId = (req.params as { agentId?: string }).agentId;
    if (!agentId) return reply.status(401).send({ error: 'Missing agent id' });
    const headerAgentId = req.headers['x-agent-id'];
    if (headerAgentId !== agentId) return reply.status(401).send({ error: 'Agent id mismatch' });
    const token = bearerToken(req);
    if (!token) return reply.status(401).send({ error: 'Missing bearer token' });
    const valid = await getStore().verifyAgentToken(agentId, token);
    if (!valid) return reply.status(401).send({ error: 'Invalid agent token' });
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/auth/whoami', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return { agent };
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/server/info', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return {
      agent,
      channels: await store.listChannels(),
      agents: await store.listAgents(),
      version: createVersionInfo('server', {
        version: process.env.XOXIANG_VERSION,
        commit: process.env.XOXIANG_COMMIT_SHA ?? process.env.GITHUB_SHA,
        build: process.env.XOXIANG_BUILD_ID ?? process.env.GITHUB_RUN_ID,
      }),
    };
  });

  app.get<{ Params: { agentId: string }; Querystring: { query?: string } }>('/internal/agent/:agentId/agents/resolve', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentResolveRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return getStore().resolveAgent(parsed.data.query);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/send', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    let threadRootId = parsed.data.threadRootId;
    if (threadRootId) {
      const thread = await store.getThread(threadRootId);
      if (!thread) return reply.status(404).send({ error: 'Thread root not found' });
      if (thread.root.channelId !== channel.id) return reply.status(400).send({ error: 'Thread root belongs to another channel' });
      threadRootId = thread.root.id;
    }

    const message = await store.createMessage({
      id: nanoid(),
      channelId: channel.id,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: parsed.data.content,
      threadRootId,
    });
    if (message.threadRootId) {
      const thread = await store.getThread(message.threadRootId);
      if (thread) eventBus.emit({ type: 'thread:message:new', root: thread.root, message });
    } else {
      eventBus.emit({ type: 'message:new', message });
    }
    return reply.status(201).send(message);
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/check', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const channels = await store.listChannels();
    const channelSummaries = await Promise.all(channels.map(async (channel) => {
      const latest = (await store.listRecentMessages(channel.id, 1))[0];
      return { channelId: channel.id, channelName: channel.name, count: latest ? 1 : 0, latestMessage: latest };
    }));
    const dms = (await store.listDirectMessageThreads(agent.id)).map((thread) => ({
      otherAgentId: thread.otherAgentId,
      count: 1,
      latestMessage: thread.lastMessage,
    }));
    return { channels: channelSummaries, dms };
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; limit?: string } }>('/internal/agent/:agentId/messages/read', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageReadRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listRecentMessages(channel.id, parsed.data.limit);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/dms/send', async (req, reply) => {
    const store = getStore();
    const from = await store.getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalDmSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });

    const dm = await store.createDirectMessage({
      id: nanoid(),
      fromAgentId: from.id,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'dm:new', dm });
    deliverDirectMessage(target, dm);
    return reply.status(201).send(dm);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/delegate', async (req, reply) => {
    const from = await getStore().getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentDelegateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const delegation = await delegateAgent({
      fromAgentId: from.id,
      toAgentId: parsed.data.to,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return reply.status(delegation.status === 'failed' ? 202 : 201).send(delegation);
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; status?: string; all?: string } }>('/internal/agent/:agentId/tasks', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalTaskListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = parsed.data.channel ? await findChannel(parsed.data.channel) : undefined;
    if (parsed.data.channel && !channel) return reply.status(404).send({ error: 'Channel not found' });
    const tasks = await store.listTasks({
      channelId: channel?.id,
      status: parsed.data.status,
      assigneeId: parsed.data.all ? undefined : agent.id,
    });
    return tasks;
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; status?: string } }>('/internal/agent/:agentId/goals', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = parsed.data.channel ? await findChannel(parsed.data.channel) : undefined;
    if (parsed.data.channel && !channel) return reply.status(404).send({ error: 'Channel not found' });
    return store.listGoals({ channelId: channel?.id, status: parsed.data.status });
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/goals', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const goal = await store.createGoal({
      id: nanoid(),
      channelId: channel.id,
      requesterName: agent.displayName ?? agent.name,
      objective: parsed.data.objective,
      background: parsed.data.background,
      successCriteria: parsed.data.successCriteria,
      constraints: parsed.data.constraints,
      assumptions: parsed.data.assumptions,
      risks: parsed.data.risks,
      status: 'draft',
    });
    eventBus.emit({ type: 'goal:update', goal });
    return reply.status(201).send(goal);
  });

  app.get<{ Params: { agentId: string; goalId: string } }>('/internal/agent/:agentId/goals/:goalId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const goal = await store.getGoal(req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const tasks = (await store.listTasks({ channelId: goal.channelId })).filter((task) => task.context?.goalId === goal.id);
    return { goal, tasks };
  });

  app.post<{ Params: { agentId: string; goalId: string } }>('/internal/agent/:agentId/goals/:goalId/tasks', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const goal = await store.getGoal(req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const parsed = InternalGoalCreateTasksRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const tasks = [];
    for (const draft of parsed.data.tasks) {
      const task = await store.createTask({
        id: nanoid(),
        channelId: goal.channelId,
        messageId: goal.sourceMessageId,
        title: draft.title,
        status: 'todo',
        creatorName: parsed.data.creatorName,
        assigneeId: draft.assigneeId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: goal.background.join('\n'),
          acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
          constraints: goal.constraints,
          assumptions: goal.assumptions,
          risks: goal.risks,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: goal.sourceMessageId ? [goal.sourceMessageId] : undefined,
        },
      });
      eventBus.emit({ type: 'task:update', task });
      await notifyTaskAssignee(task);
      tasks.push(task);
    }
    return reply.status(201).send({ tasks });
  });

  app.post<{ Params: { agentId: string }; Querystring: { messageId?: string } }>('/internal/agent/:agentId/goals/align', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!req.query.messageId) return reply.status(400).send({ error: 'Missing messageId' });
    const parsed = InternalGoalAlignRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const message = await store.getMessage(req.query.messageId);
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const objective = parsed.data.objective ?? message.content.slice(0, 240);
    const recommendation = recommendAgentsForGoal(objective, await store.listAgents());
    const questions = buildClarifyingQuestions(message);
    const riskLevel = inferGoalRiskLevel(message);
    const alignment = await store.createGoalAlignment({
      id: nanoid(),
      channelId: message.channelId,
      threadRootId: message.threadRootId ?? message.id,
      sourceMessageId: message.id,
      status: questions.length > 0 || riskLevel !== 'low' ? 'needs_clarification' : 'awaiting_confirmation',
      objective,
      questions,
      answers: [],
      successCriteria: ['A confirmed plan exists with clear task owners and acceptance criteria.'],
      constraints: riskLevel === 'high' ? ['Wait for explicit user confirmation before execution.'] : [],
      planSummary: buildPlanSummary(objective, recommendation, riskLevel),
      taskDrafts: buildTaskDrafts(objective, recommendation),
      recommendedAgentIds: recommendation.ownerAgentIds,
      reviewerAgentIds: recommendation.reviewerAgentIds,
      recommendationReasons: recommendation.reasons,
      gaps: recommendation.gaps,
      riskLevel,
    });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    await store.createMessage({
      id: nanoid(),
      channelId: alignment.channelId,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: [
        `Goal alignment started: ${alignment.objective}`,
        alignment.planSummary,
        alignment.questions.length > 0 ? `Clarifying questions:\n${alignment.questions.map((question) => `- ${question}`).join('\n')}` : 'Plan is ready for confirmation.',
      ].filter(Boolean).join('\n\n'),
      threadRootId: alignment.threadRootId,
    });
    return reply.status(201).send(alignment);
  });

  app.get<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const alignment = await store.getGoalAlignment(req.params.alignmentId);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    return alignment;
  });

  app.post<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalAlignmentPatchRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const alignment = await store.updateGoalAlignment(req.params.alignmentId, parsed.data);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    return alignment;
  });

  app.post<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId/confirm', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = ConfirmGoalAlignmentRequestSchema.safeParse({ requesterName: agent.displayName ?? agent.name });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const alignment = await store.getGoalAlignment(req.params.alignmentId);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    if (alignment.status === 'cancelled') return reply.status(409).send({ error: 'Goal alignment is cancelled' });
    const goal = alignment.goalId
      ? await store.updateGoal(alignment.goalId, {
          objective: alignment.objective,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          status: 'confirmed',
        })
      : await store.createGoal({
          id: nanoid(),
          channelId: alignment.channelId,
          sourceMessageId: alignment.sourceMessageId,
          requesterName: parsed.data.requesterName,
          objective: alignment.objective,
          background: alignment.answers,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          risks: alignment.riskLevel === 'low' ? [] : [`${alignment.riskLevel} risk plan; keep user confirmation explicit.`],
          status: 'confirmed',
        });
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    eventBus.emit({ type: 'goal:update', goal });
    const tasks = [];
    for (const draft of alignment.taskDrafts) {
      const task = await store.createTask({
        id: nanoid(),
        channelId: alignment.channelId,
        messageId: alignment.sourceMessageId,
        title: draft.title,
        status: 'todo',
        creatorName: parsed.data.requesterName,
        assigneeId: draft.assigneeId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: alignment.planSummary,
          acceptanceCriteria: (draft.acceptanceCriteria?.length ?? 0) > 0 ? draft.acceptanceCriteria : alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: [alignment.sourceMessageId],
        },
      });
      eventBus.emit({ type: 'task:update', task });
      await notifyTaskAssignee(task);
      tasks.push(task);
    }
    const updated = await store.updateGoalAlignment(alignment.id, { status: 'confirmed', goalId: goal.id });
    if (updated) eventBus.emit({ type: 'goal-alignment:update', alignment: updated });
    return reply.status(201).send({ alignment: updated ?? alignment, goal, tasks });
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listReminders(agent.id);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateReminderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const reminder = await store.createReminder({
      id: nanoid(),
      agentId: agent.id,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    eventBus.emit({ type: 'reminder:update', reminder });
    return reply.status(201).send(reminder);
  });

  app.post<{ Params: { agentId: string; reminderId: string } }>('/internal/agent/:agentId/reminders/:reminderId/cancel', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = PatchReminderRequestSchema.safeParse({ status: 'cancelled' });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await store.getReminder(req.params.reminderId);
    if (!existing || existing.agentId !== agent.id) return reply.status(404).send({ error: 'Reminder not found' });
    const reminder = await store.updateReminder(existing.id, { status: parsed.data.status });
    if (reminder) eventBus.emit({ type: 'reminder:update', reminder });
    return reminder;
  });

  app.get<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const task = await store.getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.assigneeId && task.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/update', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const task = await store.updateTask(req.params.taskId, parsed.data);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/handoff', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskHandoffRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });
    const nextNote = [
      `from ${agent.displayName ?? agent.name}: ${parsed.data.notes}`,
      parsed.data.nextStep ? `next: ${parsed.data.nextStep}` : undefined,
    ].filter(Boolean).join('\n');
    const task = await store.updateTask(existing.id, {
      assigneeId: target.id,
      context: {
        ...existing.context,
        goal: parsed.data.goal ?? existing.context?.goal,
        previousAgentId: agent.id,
        handoffNotes: [...(existing.context?.handoffNotes ?? []), nextNote],
      },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return task;
  });
}

function bearerToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  const match = typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/i) : undefined;
  return match?.[1];
}

async function findChannel(value: string) {
  const store = getStore();
  const byId = await store.getChannel(value);
  if (byId) return byId;
  return (await store.listChannels()).find((channel) => channel.name === value);
}

function buildTaskDrafts(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>): GoalAlignment['taskDrafts'] {
  const owner = recommendation.ownerAgentIds[0];
  const reviewer = recommendation.reviewerAgentIds[0];
  return [
    {
      title: `Plan: ${objective}`.slice(0, 200),
      assigneeId: owner,
      role: 'owner',
      acceptanceCriteria: ['Scope, milestones, and handoff points are clear.'],
    },
    {
      title: `Review acceptance for: ${objective}`.slice(0, 200),
      assigneeId: reviewer,
      role: 'reviewer',
      dependencies: owner ? [`Owner plan from ${owner}`] : [],
      acceptanceCriteria: ['Review notes and acceptance risks are documented.'],
    },
  ];
}

function buildPlanSummary(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>, riskLevel: GoalAlignment['riskLevel']): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'No owner match';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'No reviewer match';
  return `Draft plan for "${objective}". Owners: ${owners}. Reviewers: ${reviewers}. Risk: ${riskLevel}.`;
}

function deliverDirectMessage(target: Agent, dm: DirectMessage): void {
  if (!target.machineId || target.status === 'inactive') return;
  daemonRegistry.send(target.machineId, {
    type: 'agent:deliver',
    agentId: target.id,
    seq: Date.now(),
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    config: toRuntimeConfig(target),
    message: {
      id: dm.id,
      channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
      channelName: `DM from ${dm.fromAgentId}`,
      senderName: dm.fromAgentId,
      content: dm.content,
      createdAt: dm.createdAt,
    },
  });
}
