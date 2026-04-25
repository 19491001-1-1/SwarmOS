import type { Agent, Task } from '@mini-slock/shared';
import { resolveStartMachineId, toRuntimeConfig } from '@mini-slock/hub-core';
import { nanoid } from 'nanoid';
import { daemonRegistry } from './daemonRegistry.js';
import { getStore } from './db.js';
import { eventBus } from './events.js';
import { toAgentRuntimeConfig } from './runtimeConfig.js';

const ACTIVE_STATUSES = new Set(['starting', 'running', 'working', 'idle']);

export async function notifyTaskAssignee(task: Task): Promise<void> {
  if (!task.assigneeId || task.status === 'done') return;
  const store = getStore();
  const target = await store.findAgentByNameOrId(task.assigneeId);
  if (!target) return;

  const message = toTaskDelivery(task);
  if (ACTIVE_STATUSES.has(target.status) && target.machineId) {
    daemonRegistry.send(target.machineId, {
      type: 'agent:deliver',
      agentId: target.id,
      seq: Date.now(),
      channelId: message.channelId,
      config: toRuntimeConfig(target),
      message,
    });
    return;
  }

  if (!target.autoStart) return;
  const machineId = resolveStartMachineId({
    agent: target,
    machines: await store.listMachines(),
    connectedMachineIds: new Set(daemonRegistry.listConnectedMachineIds()),
  });
  if (!machineId) return;

  const sent = daemonRegistry.send(machineId, {
    type: 'agent:start',
    agentId: target.id,
    config: await toAgentRuntimeConfig(target),
    launchId: nanoid(),
    wakeMessage: message,
  });
  if (!sent) return;
  const updated = await store.updateAgent(target.id, { machineId, status: 'starting' });
  if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
}

export async function buildOpenTaskSummary(agent: Agent): Promise<string | undefined> {
  const tasks = (await getStore().listTasks({ assigneeId: agent.id }))
    .filter((task) => task.status !== 'done')
    .slice(0, 20);
  if (tasks.length === 0) return undefined;
  return [
    'Open tasks assigned to you:',
    ...tasks.map((task) => `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}`),
    '',
    'Use `xoxiang task list`, `xoxiang task read <taskId>`, and `xoxiang task update <taskId> --status in_progress|in_review|done` to manage them.',
  ].join('\n');
}

export function toTaskDelivery(task: Task) {
  return {
    id: `task:${task.id}:${task.updatedAt}`,
    channelId: `task:${task.id}`,
    channelName: `Task ${task.id}`,
    senderName: 'task-board',
    content: [
      `Task assigned or updated: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      `Channel: ${task.channelId}`,
      '',
      'Use `xoxiang task read <taskId>` for details and `xoxiang task update <taskId> --status in_progress|in_review|done` when you make progress.',
    ].join('\n'),
    createdAt: task.updatedAt,
  };
}
