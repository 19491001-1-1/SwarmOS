import { nanoid } from 'nanoid';
import type { Agent, AgentDelegation, DirectMessage } from '@crewden/shared';
import { resolveStartMachineId, toRuntimeConfig } from '@crewden/hub-core';
import { getStore } from './db.js';
import { daemonRegistry } from './daemonRegistry.js';
import { eventBus } from './events.js';
import { toAgentRuntimeConfig } from './runtimeConfig.js';

const ACTIVE_STATUSES = new Set(['starting', 'running', 'working', 'idle']);

export async function delegateAgent(input: {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  startIfInactive?: boolean;
}): Promise<AgentDelegation> {
  const store = getStore();
  const target = await store.findAgentByNameOrId(input.toAgentId);
  if (!target) {
    const failed = await store.createAgentDelegation({
      id: nanoid(),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      content: input.content,
      status: 'failed',
      error: JSON.stringify({
        message: 'Target agent not found',
        resolve: await store.resolveAgent(input.toAgentId),
      }),
    });
    await store.appendAuditLog({
      actorType: 'agent',
      actorId: input.fromAgentId,
      action: 'agent.delegation_failed',
      entityType: 'agent_delegation',
      entityId: failed.id,
      agentId: input.fromAgentId,
      detailJson: { toAgentId: input.toAgentId, reason: 'target_not_found' },
    });
    eventBus.emit({ type: 'agent:delegation', delegation: failed });
    return failed;
  }

  let delegation = await store.createAgentDelegation({
    id: nanoid(),
    fromAgentId: input.fromAgentId,
    toAgentId: target.id,
    content: input.content,
    status: 'queued',
  });
  await store.appendAuditLog({
    actorType: 'agent',
    actorId: input.fromAgentId,
    action: 'agent.delegated',
    entityType: 'agent_delegation',
    entityId: delegation.id,
    agentId: input.fromAgentId,
    detailJson: { toAgentId: target.id, status: delegation.status, startIfInactive: input.startIfInactive ?? true },
  });
  eventBus.emit({ type: 'agent:delegation', delegation });

  const dm = await store.createDirectMessage({
    id: nanoid(),
    fromAgentId: input.fromAgentId,
    toAgentId: target.id,
    content: input.content,
  });
  eventBus.emit({ type: 'dm:new', dm });

  if (ACTIVE_STATUSES.has(target.status) && target.machineId) {
    const sent = deliverDelegation(target, dm);
    delegation = await updateDelegation(delegation.id, sent ? 'delivered' : 'failed', sent ? undefined : 'Machine not connected');
    return delegation;
  }

  if (input.startIfInactive === false) {
    delegation = await updateDelegation(delegation.id, 'queued');
    return delegation;
  }

  const machineId = resolveStartMachineId({
    agent: target,
    machines: await store.listMachines(),
    connectedMachineIds: new Set(daemonRegistry.listConnectedMachineIds()),
  });
  if (!machineId) {
    delegation = await updateDelegation(delegation.id, 'failed', 'No connected machine available for agent runtime');
    return delegation;
  }

  const sent = daemonRegistry.send(machineId, {
    type: 'agent:start',
    agentId: target.id,
    config: await toAgentRuntimeConfig(target),
    launchId: nanoid(),
    wakeMessage: toDelegationDelivery(dm),
  });
  if (!sent) {
    delegation = await updateDelegation(delegation.id, 'failed', 'Machine not connected');
    return delegation;
  }

  const updatedAgent = await store.updateAgent(target.id, { machineId, status: 'starting' });
  if (updatedAgent) eventBus.emit({ type: 'agent:update', agent: updatedAgent });
  delegation = await updateDelegation(delegation.id, 'started');
  return delegation;
}

function deliverDelegation(target: Agent, dm: DirectMessage): boolean {
  if (!target.machineId) return false;
  return daemonRegistry.send(target.machineId, {
    type: 'agent:deliver',
    agentId: target.id,
    seq: Date.now(),
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    config: toRuntimeConfig(target),
    message: toDelegationDelivery(dm),
  });
}

function toDelegationDelivery(dm: DirectMessage) {
  return {
    id: dm.id,
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    channelName: `DM from ${dm.fromAgentId}`,
    senderName: dm.fromAgentId,
    content: dm.content,
    createdAt: dm.createdAt,
  };
}

async function updateDelegation(id: string, status: AgentDelegation['status'], error?: string): Promise<AgentDelegation> {
  const updated = await getStore().updateAgentDelegation(id, { status, error });
  if (!updated) throw new Error(`Delegation ${id} not found`);
  await getStore().appendAuditLog({
    actorType: 'system',
    action: 'agent.delegation_status_changed',
    entityType: 'agent_delegation',
    entityId: updated.id,
    agentId: updated.fromAgentId,
    detailJson: { fromAgentId: updated.fromAgentId, toAgentId: updated.toAgentId, status: updated.status, error: updated.error },
  });
  eventBus.emit({ type: 'agent:delegation', delegation: updated });
  return updated;
}
