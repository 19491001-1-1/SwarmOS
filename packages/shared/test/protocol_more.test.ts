import { describe, it, expect } from 'vitest';
import {
  DaemonActionRequestSchema,
  DaemonActionResultSchema,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  ThoughtLogEventSchema,
  LockStatusSchema,
  TimeoutErrorPayloadSchema,
} from '../src/protocol';

describe('shared protocol - additional contracts', () => {
  it('validates a minimal daemon action request', () => {
    const ok = DaemonActionRequestSchema.safeParse({ action_id: 'act1', agent_id: 'a1', tool: 'file_write' });
    expect(ok.success).toBe(true);
  });

  it('validates a daemon action result', () => {
    const ok = DaemonActionResultSchema.safeParse({ action_id: 'act1', status: 'success', stdout: 'ok' });
    expect(ok.success).toBe(true);
  });

  it('validates approval request and decision', () => {
    expect(ApprovalRequestSchema.safeParse({ approval_id: 'ap1', reason: 'danger' }).success).toBe(true);
    expect(ApprovalDecisionSchema.safeParse({ approval_id: 'ap1', approved: true }).success).toBe(true);
  });

  it('validates thought log event', () => {
    expect(ThoughtLogEventSchema.safeParse({ event_id: 'e1', type: 'thought_log', message: 'thinking' }).success).toBe(true);
  });

  it('validates lock status and timeout payload', () => {
    expect(LockStatusSchema.safeParse({ path: '/tmp/x', state: 'unlocked' }).success).toBe(true);
    expect(TimeoutErrorPayloadSchema.safeParse({ action_id: 'act1', timeout_seconds: 60, killed: true }).success).toBe(true);
  });
});
