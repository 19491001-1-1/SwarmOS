import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

describe('App', () => {
  beforeEach(() => {
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

    expect(screen.queryByText('+ NEW')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open agents' }));

    await waitFor(() => {
      expect(screen.getByText('+ NEW')).toBeTruthy();
    });
  });
});

vi.mock('../src/api.js', () => ({
  WEB_COMMIT_SHA: 'test-commit',
  WEB_VERSION: 'test-version',
  buildWsUrl: (path: string) => `ws://localhost${path}`,
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
  getAgentReminders: vi.fn(async () => []),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  searchMessages: vi.fn(async () => ({ messages: [] })),
}));
