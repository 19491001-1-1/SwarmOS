import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObservabilityPanel } from '../src/components/ObservabilityPanel.js';

vi.mock('../src/api.js', () => ({
  decideApproval: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'AuthError';
    }
  },
  WEB_COMMIT_SHA: 'test-commit',
  WEB_VERSION: 'test-version',
  buildWsUrl: (path: string) => `ws://localhost${path}`,
  setAuthFailureHandler: vi.fn(),
  verifyAuthToken: vi.fn(),
  getChannels: vi.fn(),
  getMessages: vi.fn(),
  getMessageThread: vi.fn(),
  sendMessage: vi.fn(),
  getAgents: vi.fn(),
  getMachines: vi.fn(),
  getAgentActivities: vi.fn(),
  getApprovals: vi.fn(),
  patchAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getHubVersion: vi.fn(),
  getTasks: vi.fn(),
  messageToTask: vi.fn(),
  messageToGoal: vi.fn(),
  startGoalAlignment: vi.fn(),
  patchGoalAlignment: vi.fn(),
  confirmGoalAlignment: vi.fn(),
  patchGoal: vi.fn(),
  createGoalTasks: vi.fn(),
  searchKnowledge: vi.fn(),
  createKnowledge: vi.fn(),
  patchKnowledge: vi.fn(),
  getAgentReminders: vi.fn(),
  getAgentDmThreads: vi.fn(),
  getAgentDirectMessages: vi.fn(),
  sendAgentDirectMessage: vi.fn(),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  searchMessages: vi.fn(),
}));

import * as api from '../src/api.js';

describe('ObservabilityPanel', () => {
  const mockAgents = [
    { id: 'agent-1', name: 'engineer', displayName: 'Engineer', runtime: 'claude', status: 'idle', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'agent-2', name: 'designer', displayName: 'Designer', runtime: 'claude', status: 'working', createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  const mockActivities = {
    'agent-1': [
      { id: 'act-1', agentId: 'agent-1', type: 'thinking' as const, detail: 'Analyzing requirements...', createdAt: '2026-05-22T10:00:00.000Z' },
      { id: 'act-2', agentId: 'agent-1', type: 'output' as const, detail: 'Found the bug in auth middleware', createdAt: '2026-05-22T10:01:00.000Z' },
    ],
    'agent-2': [
      { id: 'act-3', agentId: 'agent-2', type: 'working' as const, detail: 'Designing the UI mockup', createdAt: '2026-05-22T10:02:00.000Z' },
    ],
  };

  const mockApprovals: api.ApprovalRecord[] = [
    {
      id: 'ap-1',
      actionId: 'act-1',
      agentId: 'agent-1',
      reason: 'exec: rm -rf /tmp',
      status: 'pending' as const,
      createdAt: '2026-05-22T10:00:00.000Z',
    },
    {
      id: 'ap-2',
      actionId: 'act-2',
      agentId: 'agent-2',
      reason: 'exec: sudo systemctl restart',
      status: 'approved' as const,
      reviewer: 'user',
      createdAt: '2026-05-22T09:00:00.000Z',
      decidedAt: '2026-05-22T09:05:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.decideApproval).mockResolvedValue({
      id: 'ap-1',
      actionId: 'act-1',
      agentId: 'agent-1',
      reason: 'exec: rm -rf /tmp',
      status: 'approved',
      reviewer: 'user',
      createdAt: '2026-05-22T10:00:00.000Z',
      decidedAt: '2026-05-22T10:05:00.000Z',
    });
  });

  it('renders thought stream with filtered activities', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={mockActivities}
      approvals={[]}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    expect(screen.getByText('▶ OBSERVABILITY')).toBeTruthy();
    expect(screen.getByText('THOUGHT STREAM')).toBeTruthy();

    // Activity details appear in both thought stream and timeline, so use getAllByText
    const thoughtItems = screen.getAllByText('Analyzing requirements...');
    expect(thoughtItems.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Found the bug in auth middleware').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Designing the UI mockup').length).toBeGreaterThanOrEqual(1);
  });

  it('shows agent name in thought rows', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={mockActivities}
      approvals={[]}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    // Agent names appear in thought stream and may also appear in timeline
    expect(screen.getAllByText('Engineer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Designer').length).toBeGreaterThanOrEqual(1);
  });

  it('renders approval cards with approve/reject buttons for pending approvals', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    expect(screen.getByText('APPROVAL CARDS')).toBeTruthy();
    expect(screen.getByText('approve / reject pending work')).toBeTruthy();

    // Reason text appears in both approval cards and timeline
    expect(screen.getAllByText('exec: rm -rf /tmp').length).toBeGreaterThanOrEqual(1);

    const approveButtons = screen.getAllByText('APPROVE');
    expect(approveButtons.length).toBe(1);

    const rejectButtons = screen.getAllByText('REJECT');
    expect(rejectButtons.length).toBe(1);
  });

  it('shows reviewer info for decided approvals', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    // Reason text appears in both approval cards and timeline
    expect(screen.getAllByText('exec: sudo systemctl restart').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Reviewer: user/)).toBeTruthy();
  });

  it('calls decideApproval and onApprovalsUpdated when APPROVE is clicked', async () => {
    const onApprovalsUpdated = vi.fn();
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={onApprovalsUpdated}
      onOpenAgent={vi.fn()}
    />);

    fireEvent.click(screen.getByText('APPROVE'));

    await waitFor(() => {
      expect(api.decideApproval).toHaveBeenCalledWith('ap-1', true, 'user');
    });
    expect(onApprovalsUpdated).toHaveBeenCalled();
  });

  it('calls decideApproval and onApprovalsUpdated when REJECT is clicked', async () => {
    vi.mocked(api.decideApproval).mockResolvedValue({
      id: 'ap-1',
      actionId: 'act-1',
      agentId: 'agent-1',
      reason: 'exec: rm -rf /tmp',
      status: 'rejected',
      reviewer: 'user',
      createdAt: '2026-05-22T10:00:00.000Z',
      decidedAt: '2026-05-22T10:05:00.000Z',
    });

    const onApprovalsUpdated = vi.fn();
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={onApprovalsUpdated}
      onOpenAgent={vi.fn()}
    />);

    fireEvent.click(screen.getByText('REJECT'));

    await waitFor(() => {
      expect(api.decideApproval).toHaveBeenCalledWith('ap-1', false, 'user');
    });
    expect(onApprovalsUpdated).toHaveBeenCalled();
  });

  it('shows agent links in approval cards and calls onOpenAgent when clicked', () => {
    const onOpenAgent = vi.fn();
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={onOpenAgent}
    />);

    const openButtons = screen.getAllByText('OPEN');
    expect(openButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(openButtons[0]);
    expect(onOpenAgent).toHaveBeenCalledWith('agent-1');
  });

  it('renders action timeline with combined approvals and activities', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={mockActivities}
      approvals={mockApprovals}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    expect(screen.getByText('ACTION TIMELINE')).toBeTruthy();
    // Timeline headings (type/status labels) appear in both approval cards and timeline
    const statusLabels = screen.getAllByText(/awaiting_approval|approved/);
    expect(statusLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state when there are no activities or approvals', () => {
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={[]}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
    />);

    expect(screen.getByText('NO THOUGHT EVENTS')).toBeTruthy();
    expect(screen.getByText('NO APPROVALS YET')).toBeTruthy();
    expect(screen.getByText('NO ACTION STATE CHANGES')).toBeTruthy();
  });

  it('calls onClose callback when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ObservabilityPanel
      agents={mockAgents}
      activitiesByAgent={{}}
      approvals={[]}
      lockEvents={[]}
      onApprovalsUpdated={vi.fn()}
      onOpenAgent={vi.fn()}
      onClose={onClose}
    />);

    fireEvent.click(screen.getByText('X'));
    expect(onClose).toHaveBeenCalled();
  });
});
