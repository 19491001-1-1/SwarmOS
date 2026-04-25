import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateTaskRequestSchema, MessageToTaskRequestSchema, PatchTaskRequestSchema, TaskStatusSchema } from '@mini-slock/shared';
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
    const task = await getStore().updateTask(req.params.id, parsed.data);
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
}
