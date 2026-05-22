import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { onApprovalResolved } from '../actionOrchestrator.js';
import type { ApprovalRecord } from '@crewden/shared';

async function notifyApprovalTarget(type: 'approval:requested' | 'approval:resolved', approval: { id: string; agentId?: string | null }) {
  if (!approval.agentId) return false;
  const store = getStore();
  const agent = await store.getAgent(approval.agentId);
  if (!agent?.machineId) return false;
  return daemonRegistry.send(agent.machineId, { type, approval: approval as any });
}

export async function approvalRoutes(app: FastifyInstance) {
  app.get('/api/v1/approvals', async () => {
    return getStore().listApprovals();
  });

  app.post('/api/v1/approvals', async (req, reply) => {
    const body = req.body as any;
    const id = 'ap_' + nanoid();
    const createdAt = new Date().toISOString();
    const approval: ApprovalRecord = await getStore().createApproval({
      id,
      actionId: body.action_id ?? body.actionId ?? null,
      swarmId: body.swarm_id ?? body.swarmId ?? null,
      agentId: body.agent_id ?? body.agentId ?? null,
      reason: body.reason ?? null,
      riskLevel: body.risk_level ?? body.riskLevel ?? null,
      status: 'pending' as const,
      reviewer: null,
      comment: null,
      createdAt,
      decidedAt: null,
    });
    eventBus.emit({ type: 'approval:requested', approval });
    await notifyApprovalTarget('approval:requested', approval);
    return reply.status(201).send(approval);
  });

  app.get<{ Params: { id: string } }>('/api/v1/approvals/:id', async (req, reply) => {
    const approval = await getStore().getApproval(req.params.id);
    if (!approval) return reply.status(404).send({ error: 'Approval not found' });
    return approval;
  });

  app.post<{ Params: { id: string }; Body: any }>('/api/v1/approvals/:id/decision', async (req, reply) => {
    const body = req.body as any;
    if (typeof body.approved !== 'boolean') return reply.status(400).send({ error: 'approved:boolean required' });
    const updated = await getStore().decideApproval(req.params.id, { approved: body.approved, reviewer: body.reviewer, comment: body.comment });
    if (!updated) return reply.status(404).send({ error: 'Approval not found' });
    eventBus.emit({ type: 'approval:resolved', approval: updated });
    await notifyApprovalTarget('approval:resolved', updated);
    // Resume daemon action if pending
    await onApprovalResolved(updated.id, updated.status as 'approved' | 'rejected').catch(() => {});
    return updated;
  });
}
