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

  it('lets a user turn a chat message into a goal and create a contextual task', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      {
        id: 'msg-1',
        channelId: 'general',
        senderName: 'user',
        content: 'Help me ship a Mac voice input MVP',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    vi.mocked(api.messageToGoal).mockResolvedValueOnce({
      id: 'goal-1',
      channelId: 'general',
      sourceMessageId: 'msg-1',
      requesterName: 'user',
      objective: 'Help me ship a Mac voice input MVP',
      background: [],
      successCriteria: [],
      constraints: [],
      assumptions: [],
      risks: [],
      status: 'draft',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    });
    vi.mocked(api.patchGoal).mockResolvedValueOnce({
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
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:02.000Z',
    });
    vi.mocked(api.createGoalTasks).mockResolvedValueOnce({
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
      expect(screen.getByText('GOAL BRIEF')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('SUCCESS CRITERIA'), { target: { value: 'MVP plan is actionable' } });
    fireEvent.click(screen.getByText('CONFIRM GOAL'));

    await waitFor(() => {
      expect(api.patchGoal).toHaveBeenCalledWith('goal-1', expect.objectContaining({ status: 'confirmed' }));
    });

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Draft MVP plan' } });
    fireEvent.click(screen.getByText('CREATE TASK'));

    await waitFor(() => {
      expect(screen.getByText('Draft MVP plan')).toBeTruthy();
      expect(screen.getByText('GOAL: Help me ship a Mac voice input MVP')).toBeTruthy();
      expect(screen.getAllByText('MVP plan is actionable').length).toBeGreaterThan(0);
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
  patchGoal: vi.fn(),
  createGoalTasks: vi.fn(),
  getAgentReminders: vi.fn(async () => []),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  searchMessages: vi.fn(async () => ({ messages: [] })),
}));
