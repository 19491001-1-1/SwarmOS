import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateTaskRequestSchema, CreateTaskReviewRequestSchema, MessageToTaskRequestSchema, PatchTaskRequestSchema, ReviewDecisionRequestSchema, TaskStatusSchema, type TaskReview, type TaskStatus } from '@crewden/shared';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { notifyTaskAssignee } from '../taskDelivery.js';

export async function taskRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { channelId?: string; status?: string } }>('/api/tasks', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : TaskStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid status' });
    return getStore().listTasks({
      channelId: req.query.channelId,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post('/api/tasks', async (req, reply) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await getStore().getChannel(parsed.data.channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const task = await getStore().createTask({
      id: nanoid(),
      channelId: parsed.data.channelId,
      messageId: parsed.data.messageId,
      title: parsed.data.title,
      status: 'todo',
      creatorName: parsed.data.creatorName,
      assigneeId: parsed.data.assigneeId,
      context: parsed.data.context,
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return reply.status(201).send(task);
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const parsed = PatchTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const store = getStore();
    const existing = await store.getTask(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (parsed.data.status && !isTaskTransitionAllowed(existing.status, parsed.data.status)) {
      return reply.status(422).send({ error: 'Invalid task status transition', from: existing.status, to: parsed.data.status });
    }
    const task = await store.updateTask(req.params.id, parsed.data);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return task;
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const ok = await getStore().deleteTask(req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Task not found' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/messages/:id/to-task', async (req, reply) => {
    const store = getStore();
    const message = await store.getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });
    const parsed = MessageToTaskRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const task = await store.createTask({
      id: nanoid(),
      channelId: message.channelId,
      messageId: message.id,
      title: message.content.slice(0, 200),
      status: 'todo',
      creatorName: parsed.data.creatorName,
      assigneeId: parsed.data.assigneeId,
      context: {
        ...parsed.data.context,
        sourceMessageIds: Array.from(new Set([...(parsed.data.context?.sourceMessageIds ?? []), message.id])),
      },
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return reply.status(201).send(task);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/reviews', async (req, reply) => {
    const task = await getStore().getTask(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task.context?.reviews ?? [];
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/reviews', async (req, reply) => {
    const store = getStore();
    const task = await store.getTask(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    const parsed = CreateTaskReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (isHighRisk(task) && parsed.data.requesterAgentId && parsed.data.reviewerAgentId === parsed.data.requesterAgentId && !parsed.data.allowSelfReview) {
      return reply.status(400).send({ error: 'High risk task requires a different reviewer' });
    }
    const review = createReview(task.id, parsed.data);
    const taskUpdated = await store.updateTask(task.id, {
      status: 'in_review',
      context: {
        ...task.context,
        reviewerAgentId: parsed.data.reviewerAgentId,
        evidence: review.evidence,
        acceptanceChecklist: review.checklist.map((item) => item.label),
        reviewIds: [...(task.context?.reviewIds ?? []), review.id],
        reviewNotes: [...(task.context?.reviewNotes ?? []), parsed.data.selfReviewReason ? `self-review allowed: ${parsed.data.selfReviewReason}` : parsed.data.comment ?? 'review requested'],
        reviews: [...(task.context?.reviews ?? []), review],
      },
    });
    if (!taskUpdated) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task: taskUpdated });
    return reply.status(201).send(review);
  });

  app.post<{ Params: { id: string } }>('/api/reviews/:id/approve', async (req, reply) => {
    return reviewDecision(req.params.id, req.body, 'approved', reply);
  });

  app.post<{ Params: { id: string } }>('/api/reviews/:id/request-changes', async (req, reply) => {
    return reviewDecision(req.params.id, req.body, 'changes_requested', reply);
  });
}

async function reviewDecision(reviewId: string, body: unknown, status: 'approved' | 'changes_requested', reply: any) {
  const parsed = ReviewDecisionRequestSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
  const store = getStore();
  const task = (await store.listTasks()).find((candidate) => candidate.context?.reviews?.some((review) => review.id === reviewId));
  if (!task) return reply.status(404).send({ error: 'Review not found' });
  const now = new Date().toISOString();
  const reviews = (task.context?.reviews ?? []).map((review) => review.id === reviewId
    ? { ...review, reviewerAgentId: parsed.data.reviewerAgentId ?? review.reviewerAgentId, status, comment: parsed.data.comment, checklist: review.checklist.map((item) => ({ ...item, checked: status === 'approved' ? true : item.checked })), updatedAt: now }
    : review);
  const updated = await store.updateTask(task.id, {
    status: status === 'approved' ? 'done' : 'in_progress',
    context: {
      ...task.context,
      reviewNotes: [...(task.context?.reviewNotes ?? []), `${status}: ${parsed.data.comment}`],
      reviews,
    },
  });
  if (!updated) return reply.status(404).send({ error: 'Task not found' });
  eventBus.emit({ type: 'task:update', task: updated });
  return reply.status(200).send(reviews.find((review) => review.id === reviewId));
}

function createReview(taskId: string, data: { requesterAgentId?: string; reviewerAgentId?: string; evidence: string[]; checklist: Array<string | { label: string; checked: boolean }>; comment?: string }): TaskReview {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    taskId,
    requesterAgentId: data.requesterAgentId,
    reviewerAgentId: data.reviewerAgentId,
    status: 'requested',
    evidence: data.evidence,
    checklist: data.checklist.map((item) => typeof item === 'string' ? { label: item, checked: false } : item),
    comment: data.comment,
    createdAt: now,
    updatedAt: now,
  };
}

function isHighRisk(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()));
}

function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  if (to === 'cancelled') return true;
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    todo: ['in_progress', 'blocked'],
    in_progress: ['in_review', 'blocked'],
    in_review: ['done'],
    done: [],
    blocked: ['todo'],
    cancelled: [],
  };
  return allowed[from].includes(to);
}
