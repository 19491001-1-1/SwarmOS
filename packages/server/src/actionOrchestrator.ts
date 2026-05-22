import type { DaemonActionUpdate, DaemonActionRequest } from '@crewden/shared';
import { getStore } from './db.js';
import { daemonRegistry } from './daemonRegistry.js';
import { eventBus } from './events.js';

/** Actions queued for retry when a lock is released, keyed by file path */
const lockWaitQueue = new Map<string, Array<{ actionId: string; agentId: string; machineId: string }>>();

/** Map of actionId -> full action dispatch context for retry */
const dispatchedActions = new Map<string, {
  agentId: string;
  machineId: string;
  action: DaemonActionRequest;
}>();

/** Map of approvalId -> pending action details for resume after approval decision */
const pendingApprovalActions = new Map<string, {
  agentId: string;
  action: DaemonActionUpdate;
  machineId: string;
  /** If true, the action was intercepted server-side and needs re-dispatch */
  serverSide?: boolean;
  originalAction?: DaemonActionRequest;
}>();

/**
 * Store a dispatched action so it can be retried later (e.g. after lock release).
 * Called from the action dispatch route after sending action:execute to daemon.
 */
export function registerDispatchedAction(
  actionId: string,
  agentId: string,
  machineId: string,
  action: DaemonActionRequest,
): void {
  dispatchedActions.set(actionId, { agentId, machineId, action });
}

/**
 * Register a server-side intercepted action that needs approval.
 * Called from the action dispatch route when risk policy triggers.
 */
export function registerServerSidePending(
  approvalId: string,
  agentId: string,
  machineId: string,
  originalAction: DaemonActionRequest,
): void {
  pendingApprovalActions.set(approvalId, {
    agentId,
    machineId,
    serverSide: true,
    originalAction,
    action: {
      action_id: originalAction.action_id,
      status: 'awaiting_approval',
      approval_id: approvalId,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Handle a daemon:action:update message.
 *
 * - risk_detected: auto-creates an approval record on the server.
 * - waiting_lock: enqueues the action for retry when the lock is released.
 * - awaiting_approval: registers for later resume.
 */
export async function handleDaemonActionUpdate(
  agentId: string,
  action: DaemonActionUpdate,
  machineId: string,
): Promise<void> {
  const status = action.status;

  if (status === 'risk_detected') {
    if (action.approval_id) {
      await ensureApprovalCreated(agentId, action);
      pendingApprovalActions.set(action.approval_id, { agentId, action, machineId });
    }
  }

  if (status === 'waiting_lock') {
    // Store the action_id so we can look up the full request from dispatchedActions on retry
    const lockPath = action.lock_owner ?? 'unknown';
    const queue = lockWaitQueue.get(lockPath) ?? [];
    queue.push({ actionId: action.action_id, agentId, machineId });
    lockWaitQueue.set(lockPath, queue);
  }

  if (status === 'awaiting_approval' && action.approval_id) {
    if (!pendingApprovalActions.has(action.approval_id)) {
      pendingApprovalActions.set(action.approval_id, { agentId, action, machineId });
    }
  }
}

async function ensureApprovalCreated(agentId: string, action: DaemonActionUpdate): Promise<void> {
  if (!action.approval_id) return;
  const store = getStore();
  const existing = await store.getApproval(action.approval_id);
  if (!existing) {
    const approval = await store.createApproval({
      id: action.approval_id,
      actionId: action.action_id,
      agentId,
      reason: `Action ${action.action_id} flagged as risk_detected`,
      riskLevel: 'medium',
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewer: null,
      comment: null,
      decidedAt: null,
    });
    eventBus.emit({ type: 'approval:requested', approval });
  }
}

/**
 * Called when a lock:update with state=released arrives.
 * Retries all actions queued for that lock path by looking up the
 * original DaemonActionRequest from dispatchedActions.
 */
export async function onLockReleased(path: string): Promise<void> {
  const queue = lockWaitQueue.get(path);
  if (!queue || queue.length === 0) return;
  lockWaitQueue.delete(path);

  for (const entry of queue) {
    const dispatchCtx = dispatchedActions.get(entry.actionId);
    if (!dispatchCtx) continue;
    dispatchedActions.delete(entry.actionId);

    const sent = daemonRegistry.send(entry.machineId, {
      type: 'action:execute',
      agentId: entry.agentId,
      action: dispatchCtx.action,
    });
    if (!sent) {
      // Re-queue for later if daemon is not connected
      dispatchedActions.set(entry.actionId, dispatchCtx);
      const retryQueue = lockWaitQueue.get(path) ?? [];
      retryQueue.push(entry);
      lockWaitQueue.set(path, retryQueue);
    }
  }
}

/**
 * Called when an approval is resolved (approved or rejected).
 * Resumes the pending action:
 *   - serverSide: re-dispatches action:execute to daemon
 *   - daemonSide: sends approval:resolved to daemon
 */
export async function onApprovalResolved(approvalId: string, status: 'approved' | 'rejected'): Promise<void> {
  const pending = pendingApprovalActions.get(approvalId);
  if (!pending) return;
  pendingApprovalActions.delete(approvalId);

  if (status === 'rejected') {
    return;
  }

  const store = getStore();
  const approval = await store.getApproval(approvalId);
  if (!approval) return;

  if (pending.serverSide && pending.originalAction) {
    const sent = daemonRegistry.send(pending.machineId, {
      type: 'action:execute',
      agentId: pending.agentId,
      action: pending.originalAction,
    });
    if (!sent) {
      pendingApprovalActions.set(approvalId, pending);
    }
  } else {
    const sent = daemonRegistry.send(pending.machineId, {
      type: 'approval:resolved',
      approval: {
        ...approval,
        status,
      },
    });
    if (!sent) {
      pendingApprovalActions.set(approvalId, pending);
    }
  }
}

/** Clear all state — for testing */
export function resetActionOrchestrator(): void {
  lockWaitQueue.clear();
  dispatchedActions.clear();
  pendingApprovalActions.clear();
}
