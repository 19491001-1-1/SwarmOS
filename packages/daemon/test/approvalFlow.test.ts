import { beforeEach, describe, expect, it } from 'vitest';
import { onApprovalResolved, pendingActions } from '../src/actions.js';

beforeEach(() => {
  pendingActions.clear();
});

describe('approval resume flow', () => {
  it('resumes a pending action after approval is resolved', async () => {
    pendingActions.set('ap-1', {
      action_id: 'act-1',
      agent_id: 'agent-1',
      tool: 'exec_cmd',
      params: { command: 'echo hello', timeoutSeconds: 1 },
    });

    const result = await onApprovalResolved({ id: 'ap-1', status: 'approved' });

    expect(result).toMatchObject({
      action_id: 'act-1',
      approval_id: 'ap-1',
      status: 'success',
    });
    expect((result as { stdout?: string }).stdout).toContain('[simulated] echo hello');
    expect(pendingActions.has('ap-1')).toBe(false);
  });

  it('returns a rejected result when approval is denied', async () => {
    pendingActions.set('ap-2', {
      action_id: 'act-2',
      agent_id: 'agent-2',
      tool: 'exec_cmd',
      params: { command: 'echo deny', timeoutSeconds: 1 },
    });

    const result = await onApprovalResolved({ id: 'ap-2', status: 'rejected' });

    expect(result).toMatchObject({
      action_id: 'act-2',
      approval_id: 'ap-2',
      status: 'rejected',
    });
    expect(pendingActions.has('ap-2')).toBe(false);
  });
});