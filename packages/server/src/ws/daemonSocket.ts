import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { DaemonToServerSchema } from '@crewden/shared';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { findDuplicateMachineIds, findExistingMachineId, toRuntimeConfig } from '@crewden/hub-core';
import { delegateAgent } from '../delegation.js';
import { toAgentRuntimeConfig } from '../runtimeConfig.js';
import { buildOpenTaskSummary, notifyTaskAssignee } from '../taskDelivery.js';

const VALID_KEYS = new Set(['dev-machine-key']);
const VOLATILE_AGENT_STATUSES = new Set(['starting', 'running', 'working', 'idle']);

export async function daemonSocketHandler(app: FastifyInstance) {
  app.get(
    '/daemon/connect',
    { websocket: true },
    (connection: SocketStream, req: FastifyRequest) => {
      const url = new URL(req.url!, `http://localhost`);
      const key = url.searchParams.get('key');

      if (!key || !VALID_KEYS.has(key)) {
        connection.socket.close(4001, 'Unauthorized');
        return;
      }

      let machineId: string | null = null;

      connection.socket.on('message', async (raw) => {
        let data: unknown;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const parsed = DaemonToServerSchema.safeParse(data);
        if (!parsed.success) return;

        const msg = parsed.data;
        const store = getStore();

        if (msg.type === 'ready') {
          const currentMachines = await store.listMachines();
          const readyMachineId = msg.machineId ?? findExistingMachineId({ machines: currentMachines, hostname: msg.hostname, os: msg.os }) ?? nanoid();
          machineId = readyMachineId;
          await mergeDuplicateMachines(readyMachineId, msg.hostname, msg.os);
          const machine = await store.upsertMachine({
            id: readyMachineId,
            hostname: msg.hostname,
            os: msg.os,
            daemonVersion: msg.daemonVersion,
            runtimes: msg.runtimes,
            runtimeVersions: msg.runtimeVersions,
            status: 'online',
            connectedAt: new Date().toISOString(),
          });
          daemonRegistry.register(readyMachineId, connection.socket);
          eventBus.emit({ type: 'machine:update', machine });
          await reconcileReadyAgents(readyMachineId, msg.runtimes, new Set(msg.runningAgents));
          return;
        }

        if (!machineId) return;

        if (msg.type === 'pong') return;

        if (msg.type === 'agent:status') {
          const agent = await store.updateAgentStatus(msg.agentId, msg.status);
          if (agent) eventBus.emit({ type: 'agent:update', agent });
          return;
        }

        if (msg.type === 'agent:message') {
          const channel = await store.getChannel(msg.channelId);
          if (!channel) return;
          const agent = await store.getAgent(msg.agentId);
          let threadRootId = msg.inReplyToMessageId;
          if (threadRootId) {
            const thread = await store.getThread(threadRootId);
            if (!thread || thread.root.channelId !== msg.channelId) return;
            threadRootId = thread.root.id;
          }
          const message = await store.createMessage({
            id: nanoid(),
            channelId: msg.channelId,
            agentId: msg.agentId,
            senderName: agent?.displayName ?? agent?.name ?? msg.agentId,
            content: msg.content,
            threadRootId,
          });
          if (message.threadRootId) {
            const thread = await store.getThread(message.threadRootId);
            if (thread) eventBus.emit({ type: 'thread:message:new', root: thread.root, message });
          } else {
            eventBus.emit({ type: 'message:new', message });
          }
          return;
        }

        if (msg.type === 'agent:activity') {
          const activity = await store.createAgentActivity({
            id: nanoid(),
            agentId: msg.agentId,
            type: msg.activityType,
            detail: msg.detail,
          });
          eventBus.emit({ type: 'agent:activity', agentId: msg.agentId, activity });
          return;
        }

        if (msg.type === 'agent:dm') {
          const target = await store.findAgentByNameOrId(msg.toAgentId);
          if (!target) return;
          const dm = await store.createDirectMessage({
            id: nanoid(),
            fromAgentId: msg.fromAgentId,
            toAgentId: target.id,
            content: msg.content,
          });
          eventBus.emit({ type: 'dm:new', dm });
          if (target.machineId && target.status !== 'inactive') {
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
              inboxSummary: await buildOpenTaskSummary(target),
            });
          }
          return;
        }

        if (msg.type === 'agent:delegate') {
          await delegateAgent({
            fromAgentId: msg.fromAgentId,
            toAgentId: msg.toAgentId,
            content: msg.content,
            startIfInactive: msg.startIfInactive,
          });
          return;
        }

        if (msg.type === 'agent:create_task') {
          const channelId = msg.channelId ?? 'general';
          const channel = await store.getChannel(channelId);
          if (!channel) return;
          const agent = await store.getAgent(msg.agentId);
          const assignee = msg.assigneeId ? await store.findAgentByNameOrId(msg.assigneeId) : undefined;
          const task = await store.createTask({
            id: nanoid(),
            channelId,
            title: msg.title,
            status: 'todo',
            creatorName: agent?.displayName ?? agent?.name ?? msg.agentId,
            assigneeId: assignee?.id ?? msg.assigneeId,
          });
          eventBus.emit({ type: 'task:update', task });
          await notifyTaskAssignee(task);
          return;
        }

        if (msg.type === 'agent:update_task') {
          const task = await store.updateTask(msg.taskId, { status: msg.status });
          if (task) {
            eventBus.emit({ type: 'task:update', task });
            await notifyTaskAssignee(task);
          }
          return;
        }

        if (msg.type === 'agent:set_reminder') {
          const channelId = msg.channelId ?? 'general';
          const channel = await store.getChannel(channelId);
          if (!channel) return;
          const agent = await store.getAgent(msg.agentId);
          if (!agent) return;
          const reminder = await store.createReminder({
            id: nanoid(),
            agentId: agent.id,
            channelId,
            message: msg.message,
            triggerAt: msg.triggerAt,
            status: 'pending',
          });
          eventBus.emit({ type: 'reminder:update', reminder });
          return;
        }

        if (msg.type === 'agent:cancel_reminder') {
          const reminder = await store.getReminder(msg.reminderId);
          if (!reminder || reminder.agentId !== msg.agentId) return;
          const updated = await store.updateReminder(msg.reminderId, { status: 'cancelled' });
          if (updated) eventBus.emit({ type: 'reminder:update', reminder: updated });
          return;
        }

        if (msg.type === 'agent:session') {
          return;
        }

        if (msg.type === 'agent:deliver:ack') {
          return;
        }

        if (msg.type === 'workspace:result') {
          daemonRegistry.resolveWorkspaceRead(msg.requestId, msg.result);
          return;
        }
      });

      connection.socket.on('close', async () => {
        if (machineId) {
          daemonRegistry.unregister(machineId);
          const store = getStore();
          await store.setMachineOffline(machineId);
          const machine = await store.getMachine(machineId);
          if (machine) eventBus.emit({ type: 'machine:update', machine });
          for (const agent of await store.listAgents()) {
            if (agent.machineId === machineId && VOLATILE_AGENT_STATUSES.has(agent.status)) {
              const updated = await store.updateAgentStatus(agent.id, 'inactive');
              if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
            }
          }
        }
      });

      const pingInterval = setInterval(() => {
        if (connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      connection.socket.on('close', () => clearInterval(pingInterval));
    }
  );
}

async function mergeDuplicateMachines(targetMachineId: string, hostname: string, os: string): Promise<void> {
  const store = getStore();
  const duplicateIds = findDuplicateMachineIds({
    machines: await store.listMachines(),
    targetMachineId,
    hostname,
    os,
  });
  await store.mergeMachines(targetMachineId, duplicateIds);
}

async function reconcileReadyAgents(machineId: string, runtimes: string[], runningAgents: Set<string>): Promise<void> {
  const store = getStore();
  const supportedRuntimes = new Set(runtimes);
  for (const agent of await store.listAgents()) {
    if (!agent.autoStart || !supportedRuntimes.has(agent.runtime)) continue;
    if (agent.machineId && agent.machineId !== machineId) continue;

    if (runningAgents.has(agent.id)) {
      const updated = await store.updateAgent(agent.id, { machineId, status: 'running' });
      if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
      continue;
    }

    const launchId = nanoid();
    const inboxSummary = await buildOpenTaskSummary(agent);
    const sent = daemonRegistry.send(machineId, {
      type: 'agent:start',
      agentId: agent.id,
      config: await toAgentRuntimeConfig(agent),
      launchId,
      inboxSummary,
    });
    if (!sent) continue;
    const updated = await store.updateAgent(agent.id, { machineId, status: 'starting' });
    if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
  }
}
