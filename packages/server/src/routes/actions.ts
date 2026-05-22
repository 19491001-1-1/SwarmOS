import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { daemonRegistry } from '../daemonRegistry.js';
import { eventBus } from '../events.js';
import { requiresApproval } from '../riskPolicy.js';
import { registerDispatchedAction, registerServerSidePending } from '../actionOrchestrator.js';

export async function actionRoutes(app: FastifyInstance) {
  /**
   * Dispatch an action to a specific agent's daemon.
   * Body: { agent_id, tool, target_path?, params? }
   * The server looks up the agent's machine, creates a DaemonActionRequest
   * and sends it to the daemon via WebSocket.
   */
  app.post('/api/v1/actions/dispatch', async (req, reply) => {
    const body = req.body as any;
    const agentId = body.agent_id ?? body.agentId;
    if (typeof agentId !== 'string') {
      return reply.status(400).send({ error: 'agent_id (string) is required' });
    }

    const store = getStore();
    const agent = await store.getAgent(agentId);
    if (!agent) {
      return reply.status(404).send({ error: `Agent ${agentId} not found` });
    }
    if (!agent.machineId) {
      return reply.status(400).send({ error: `Agent ${agentId} has no machine assigned` });
    }

    const actionId = 'act_' + nanoid();
    const action = {
      action_id: actionId,
      agent_id: agentId,
      tool: body.tool ?? 'exec_cmd',
      target_path: body.target_path ?? undefined,
      params: body.params ?? undefined,
      created_at: new Date().toISOString(),
    };

    // Validate action tool
    const allowedTools = ['file_read', 'file_write', 'exec_cmd', 'dir_mkdir', 'dir_readdir', 'dir_rm'];
    if (!allowedTools.includes(action.tool)) {
      return reply.status(400).send({ error: `Unknown tool: ${action.tool}. Allowed: ${allowedTools.join(', ')}` });
    }

    // Server-side risk assessment
    const risk = requiresApproval(action.tool, { command: action.params?.command, target_path: action.target_path, path: action.params?.path });
    if (risk.requiresApproval) {
      const approvalId = 'ap_' + nanoid();
      await store.createApproval({
        id: approvalId,
        actionId: actionId,
        agentId,
        reason: risk.reason,
        riskLevel: risk.level,
        status: 'pending',
        createdAt: new Date().toISOString(),
        reviewer: null,
        comment: null,
        decidedAt: null,
      });
      const approval = await store.getApproval(approvalId);
      eventBus.emit({
        type: 'approval:requested',
        approval: approval as any,
      });
      // Register for auto-resume when approval is decided
      registerServerSidePending(approvalId, agentId, agent.machineId!, action);
      return reply.status(202).send({
        action_id: actionId,
        agent_id: agentId,
        tool: action.tool,
        target_path: action.target_path,
        status: 'awaiting_approval',
        risk_level: risk.level,
        risk_reason: risk.reason,
        approval_id: approvalId,
        timestamp: action.created_at,
      });
    }

    // Send action to daemon
    const sent = daemonRegistry.send(agent.machineId, {
      type: 'action:execute',
      agentId,
      action,
    });

    if (!sent) {
      return reply.status(503).send({ error: 'Daemon not connected for this agent' });
    }

    // Register for lock-retry support
    registerDispatchedAction(actionId, agentId, agent.machineId!, action);

    // Log the action as an activity
    const activity = await store.createAgentActivity({
      id: nanoid(),
      agentId,
      type: 'working',
      detail: `action:${action.tool} dispatched (${actionId})`,
    });
    eventBus.emit({ type: 'agent:activity', agentId, activity });

    return reply.status(201).send({
      action_id: actionId,
      agent_id: agentId,
      tool: action.tool,
      target_path: action.target_path,
      status: 'dispatched',
      timestamp: action.created_at,
    });
  });

  /**
   * List recent action results for an agent (via activity log).
   */
  app.get<{ Params: { agentId: string } }>('/api/v1/actions/:agentId', async (req, reply) => {
    const { agentId } = req.params;
    const store = getStore();
    const activities = await store.listAgentActivities(agentId, 100);
    const actionActivities = activities.filter((a) => a.detail?.startsWith('action:'));
    return actionActivities;
  });
}
