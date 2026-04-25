import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import * as api from '../src/api.js';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    class MockWebSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send = vi.fn();
      close = vi.fn(() => this.onclose?.());
    }
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('keeps the agent panel collapsed until explicitly opened', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Workspace')).toBeTruthy();
    });

    expect(screen.queryByText('+ NEW')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open agents' })[0]);

    await waitFor(() => {
      expect(screen.getByText('+ NEW')).toBeTruthy();
    });
  });

  it('opens the mobile navigation drawer from the top bar', async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Workspace')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(container.querySelector('.sidebar-mobile-open')).toBeTruthy();
  });

  it('lets a user align a goal in chat and confirm contextual tasks', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      {
        id: 'msg-1',
        channelId: 'general',
        senderName: 'user',
        content: 'Help me ship a Mac voice input MVP',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    vi.mocked(api.getMessageThread).mockResolvedValueOnce({
      root: {
        id: 'msg-1',
        channelId: 'general',
        senderName: 'user',
        content: 'Help me ship a Mac voice input MVP',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
      replies: [],
    });
    vi.mocked(api.startGoalAlignment).mockResolvedValueOnce({
      id: 'alignment-1',
      channelId: 'general',
      threadRootId: 'msg-1',
      sourceMessageId: 'msg-1',
      status: 'needs_clarification',
      objective: 'Help me ship a Mac voice input MVP',
      questions: ['What does success look like for this goal?'],
      answers: [],
      successCriteria: ['MVP plan is actionable'],
      constraints: [],
      planSummary: 'Draft plan for a Mac voice input MVP.',
      taskDrafts: [{ title: 'Plan: Help me ship a Mac voice input MVP', role: 'owner', acceptanceCriteria: ['MVP plan is actionable'] }],
      recommendedAgentIds: [],
      reviewerAgentIds: [],
      recommendationReasons: {},
      gaps: ['No owner agent matched product/planning or engineering responsibilities.'],
      riskLevel: 'low',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    });
    vi.mocked(api.patchGoalAlignment).mockResolvedValueOnce({
      id: 'alignment-1',
      channelId: 'general',
      threadRootId: 'msg-1',
      sourceMessageId: 'msg-1',
      status: 'awaiting_confirmation',
      objective: 'Help me ship a Mac voice input MVP',
      questions: ['What does success look like for this goal?'],
      answers: ['MVP should be actionable'],
      successCriteria: ['MVP plan is actionable'],
      constraints: [],
      planSummary: 'Draft plan for a Mac voice input MVP.',
      taskDrafts: [{ title: 'Plan: Help me ship a Mac voice input MVP', role: 'owner', acceptanceCriteria: ['MVP plan is actionable'] }],
      recommendedAgentIds: [],
      reviewerAgentIds: [],
      recommendationReasons: {},
      gaps: [],
      riskLevel: 'low',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:02.000Z',
    });
    vi.mocked(api.confirmGoalAlignment).mockResolvedValueOnce({
      alignment: {
        id: 'alignment-1',
        channelId: 'general',
        threadRootId: 'msg-1',
        sourceMessageId: 'msg-1',
        goalId: 'goal-1',
        status: 'confirmed',
        objective: 'Help me ship a Mac voice input MVP',
        questions: [],
        answers: ['MVP should be actionable'],
        successCriteria: ['MVP plan is actionable'],
        constraints: [],
        planSummary: 'Draft plan for a Mac voice input MVP.',
        taskDrafts: [],
        recommendedAgentIds: [],
        reviewerAgentIds: [],
        recommendationReasons: {},
        gaps: [],
        riskLevel: 'low',
        createdAt: '2026-04-25T00:00:01.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      },
      goal: {
        id: 'goal-1',
        channelId: 'general',
        sourceMessageId: 'msg-1',
        requesterName: 'user',
        objective: 'Help me ship a Mac voice input MVP',
        background: [],
        successCriteria: ['MVP plan is actionable'],
        constraints: [],
        assumptions: [],
        risks: [],
        status: 'confirmed',
        createdAt: '2026-04-25T00:00:03.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      },
      tasks: [{
        id: 'task-1',
        channelId: 'general',
        messageId: 'msg-1',
        title: 'Draft MVP plan',
        status: 'todo',
        creatorName: 'user',
        context: {
          goalId: 'goal-1',
          goalObjective: 'Help me ship a Mac voice input MVP',
          acceptanceCriteria: ['MVP plan is actionable'],
        },
        createdAt: '2026-04-25T00:00:03.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      }],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Help me ship a Mac voice input MVP')).toBeTruthy();
    });

    fireEvent.click(await screen.findByTitle('Plan goal'));

    await waitFor(() => {
      expect(screen.getByText('GOAL ALIGNMENT')).toBeTruthy();
      expect(screen.getByText(/What does success look like/)).toBeTruthy();
      expect(screen.getByText('PLAN PREVIEW')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('SUCCESS CRITERIA'), { target: { value: 'MVP plan is actionable' } });
    fireEvent.change(screen.getByLabelText('ANSWERS / CONTEXT'), { target: { value: 'MVP should be actionable' } });
    fireEvent.click(screen.getByText('REVISE'));

    await waitFor(() => {
      expect(api.patchGoalAlignment).toHaveBeenCalledWith('alignment-1', expect.objectContaining({ status: 'awaiting_confirmation' }));
    });

    fireEvent.click(screen.getByText('CONFIRM PLAN'));

    await waitFor(() => {
      expect(screen.getByText('Draft MVP plan')).toBeTruthy();
      expect(screen.getByText('GOAL: Help me ship a Mac voice input MVP')).toBeTruthy();
      expect(screen.getAllByText('MVP plan is actionable').length).toBeGreaterThan(0);
    });
  });

  it('shows blocked work on task board and agent work summary', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      organization: { roles: ['Engineer'], capabilities: ['coding'] },
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getTasks).mockResolvedValue([{
      id: 'task-1',
      channelId: 'general',
      title: 'Implement coding task',
      status: 'in_review',
      creatorName: 'user',
      assigneeId: 'agent-1',
      context: {
        blockedReason: 'missing API token',
        blockedNeeds: 'user provides token',
        progressEvents: [{ id: 'evt-1', taskId: 'task-1', agentId: 'agent-1', type: 'blocked', detail: 'missing API token', createdAt: '2026-04-25T00:00:00.000Z' }],
      },
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    }]);

    render(<App />);

    fireEvent.click(await screen.findByText('Tasks'));
    await waitFor(() => {
      expect(screen.getByText('BLOCKED')).toBeTruthy();
      expect(screen.getByText('missing API token')).toBeTruthy();
      expect(screen.getByText('Needs: user provides token')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText('Engineer')[0]);
    await waitFor(() => {
      expect(screen.getByText('WORK SUMMARY')).toBeTruthy();
      expect(screen.getByText('BLOCKED 1')).toBeTruthy();
    });
  });

  it('shows review evidence and acceptance status on the task board', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-qa',
      name: 'qa',
      displayName: 'QA',
      runtime: 'codex',
      status: 'idle',
      organization: { roles: ['QA'], capabilities: ['review'] },
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getTasks).mockResolvedValue([{
      id: 'task-review',
      channelId: 'general',
      title: 'Ship reviewed feature',
      status: 'done',
      creatorName: 'user',
      context: {
        reviews: [{
          id: 'review-1',
          taskId: 'task-review',
          reviewerAgentId: 'agent-qa',
          status: 'approved',
          evidence: ['pnpm verify passed', 'web review badge visible'],
          checklist: [{ label: 'tests pass', checked: true }, { label: 'review badge visible', checked: true }],
          comment: 'verified',
          createdAt: '2026-04-25T00:00:00.000Z',
          updatedAt: '2026-04-25T00:00:01.000Z',
        }],
      },
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    }]);

    render(<App />);

    fireEvent.click(await screen.findByText('Tasks'));
    await waitFor(() => {
      expect(screen.getByText('Ship reviewed feature')).toBeTruthy();
      expect(screen.getByText('ACCEPTED')).toBeTruthy();
      expect(screen.getByText('Status: approved')).toBeTruthy();
      expect(screen.getByText('Reviewer: @QA')).toBeTruthy();
      expect(screen.getByText('Evidence: 2')).toBeTruthy();
      expect(screen.getByText('Checklist: 2')).toBeTruthy();
    });
  });
});

vi.mock('../src/api.js', () => ({
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
  verifyAuthToken: vi.fn(async () => ({ authenticated: true, mode: 'anonymous' })),
  getChannels: vi.fn(async () => [{ id: 'general', name: 'general', createdAt: '2026-04-25T00:00:00.000Z' }]),
  getMessages: vi.fn(async () => []),
  getMessageThread: vi.fn(),
  sendMessage: vi.fn(),
  getAgents: vi.fn(async () => []),
  getMachines: vi.fn(async () => []),
  getAgentActivities: vi.fn(async () => []),
  getHubVersion: vi.fn(async () => ({ component: 'hub', version: 'test-version' })),
  getTasks: vi.fn(async () => []),
  messageToTask: vi.fn(),
  messageToGoal: vi.fn(),
  startGoalAlignment: vi.fn(),
  patchGoalAlignment: vi.fn(),
  confirmGoalAlignment: vi.fn(),
  patchGoal: vi.fn(),
  createGoalTasks: vi.fn(),
  getAgentReminders: vi.fn(async () => []),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  searchMessages: vi.fn(async () => ({ messages: [] })),
}));
