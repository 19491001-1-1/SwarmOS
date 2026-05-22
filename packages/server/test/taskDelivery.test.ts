import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore, getStore } from '../src/db.js';
import { matchesAgentCapability } from '../src/taskMatching.js';
import { buildOpenTaskSummary, toTaskDelivery } from '../src/taskDelivery.js';
import type { Agent, Task } from '@crewden/shared';

beforeEach(async () => {
  await resetStore();
});

describe('matchesAgentCapability', () => {
  const baseAgent: Agent = {
    id: 'agent-1',
    name: 'engineer',
    displayName: 'Engineer',
    description: 'A generalist software engineer',
    runtime: 'claude',
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    organization: {
      roles: ['backend', 'frontend'],
      capabilities: ['typescript', 'react', 'node'],
      responsibilities: ['code review', 'testing'],
    },
  };

  const baseTask: Task = {
    id: 'task-1',
    channelId: 'general',
    title: 'Build the React frontend',
    creatorName: 'user',
    status: 'todo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    context: {
      goal: 'Ship the dashboard',
      background: 'We need a React dashboard',
      acceptanceCriteria: ['Dashboard is responsive'],
      artifacts: ['dashboard.tsx'],
    },
  };

  it('matches when task title contains agent capability keyword', () => {
    expect(matchesAgentCapability(baseAgent, baseTask)).toBe(true);
  });

  it('matches when task context goal contains agent capability', () => {
    const task: Task = { ...baseTask, title: 'Unrelated title', context: { ...baseTask.context, goal: 'Build with React and TypeScript' } };
    expect(matchesAgentCapability(baseAgent, task)).toBe(true);
  });

  it('matches when task background references agent role', () => {
    const task: Task = { ...baseTask, title: 'Unrelated', context: { ...baseTask.context, background: 'Backend API design needed' } };
    expect(matchesAgentCapability(baseAgent, task)).toBe(true);
  });

  it('matches when acceptance criteria mentions agent capability', () => {
    const task: Task = { ...baseTask, title: 'Unrelated', context: { ...baseTask.context, acceptanceCriteria: ['Node.js runtime must be used'] } };
    expect(matchesAgentCapability(baseAgent, task)).toBe(true);
  });

  it('matches when artifacts reference agent responsibility', () => {
    const task: Task = { ...baseTask, title: 'Unrelated', context: { ...baseTask.context, artifacts: ['testing-plan.md'] } };
    expect(matchesAgentCapability(baseAgent, task)).toBe(true);
  });

  it('returns false for agent with no capabilities or roles', () => {
    const emptyAgent: Agent = { ...baseAgent, organization: { roles: [], capabilities: [], responsibilities: [] } };
    expect(matchesAgentCapability(emptyAgent, baseTask)).toBe(false);
  });

  it('returns false when nothing matches', () => {
    const task: Task = {
      ...baseTask,
      title: 'Design the logo',
      context: {
        goal: 'Create branding',
        background: 'Need colors',
        acceptanceCriteria: ['Logo is pretty'],
        artifacts: ['logo.svg'],
      },
    };
    expect(matchesAgentCapability(baseAgent, task)).toBe(false);
  });

  it('is case insensitive', () => {
    const task: Task = { ...baseTask, title: 'Build with TypeScript'.toUpperCase() };
    expect(matchesAgentCapability(baseAgent, task)).toBe(true);
  });

  it('matches via agent name when it appears in task text', () => {
    const agent: Agent = { ...baseAgent, name: 'rustacean', organization: { roles: [], capabilities: [], responsibilities: [] } };
    const task: Task = { ...baseTask, title: 'Write rustacean module' };
    expect(matchesAgentCapability(agent, task)).toBe(true);
  });

  it('matches via displayName when it appears in task text', () => {
    const agent: Agent = { ...baseAgent, displayName: 'TypeScript Ninja', organization: { roles: [], capabilities: [], responsibilities: [] } };
    const task: Task = { ...baseTask, title: 'TypeScript Ninja review needed' };
    expect(matchesAgentCapability(agent, task)).toBe(true);
  });

  it('matches via description when it appears in task text', () => {
    const agent: Agent = { ...baseAgent, description: 'specializes in DevOps pipelines', organization: { roles: [], capabilities: [], responsibilities: [] } };
    const task: Task = { ...baseTask, title: 'Set up DevOps pipeline' };
    expect(matchesAgentCapability(agent, task)).toBe(true);
  });

  it('ignores capabilities shorter than 3 characters', () => {
    const agent: Agent = { ...baseAgent, organization: { roles: [], capabilities: ['go'], responsibilities: [] } };
    const task: Task = { ...baseTask, title: 'Go backend service' };
    expect(matchesAgentCapability(agent, task)).toBe(false);
  });
});

describe('buildOpenTaskSummary', () => {
  it('returns undefined when there are no relevant tasks', async () => {
    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'engineer', runtime: 'claude', status: 'idle', createdAt: new Date().toISOString() });
    await store.createAgent({ id: 'agent-2', name: 'designer', runtime: 'claude', status: 'idle', createdAt: new Date().toISOString() });
    await store.createTask({
      channelId: 'general', title: 'Design mockups', creatorName: 'user', assigneeId: 'designer', status: 'todo',
      context: { goal: 'Create UI mocks', artifacts: [], acceptanceCriteria: [], dependencies: [] },
    });

    const agent = await store.getAgent('agent-1')!;
    const summary = await buildOpenTaskSummary(agent!);
    expect(summary).toBeUndefined();
  });

  it('includes assigned open tasks for the agent', async () => {
    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'engineer', runtime: 'claude', status: 'idle', createdAt: new Date().toISOString() });
    await store.createTask({
      channelId: 'general', title: 'Fix login bug', creatorName: 'user', assigneeId: 'agent-1', status: 'in_progress',
      context: { goal: 'Fix auth', artifacts: [], acceptanceCriteria: [], dependencies: [] },
    });
    await store.createTask({
      channelId: 'general', title: 'Add tests', creatorName: 'user', assigneeId: 'agent-1', status: 'todo',
      context: { goal: 'Improve coverage', artifacts: [], acceptanceCriteria: [], dependencies: [] },
    });

    const agent = await store.getAgent('agent-1')!;
    const summary = await buildOpenTaskSummary(agent!);
    expect(summary).toContain('Open tasks assigned to you:');
    expect(summary).toContain('Fix login bug');
    expect(summary).toContain('Add tests');
  });

  it('includes claimable unassigned tasks matching agent capability', async () => {
    const store = getStore();
    await store.createAgent({
      id: 'agent-1', name: 'engineer', runtime: 'claude', status: 'idle',
      organization: { roles: ['backend'], capabilities: ['node'], responsibilities: [] },
      createdAt: new Date().toISOString(),
    });
    await store.createTask({
      channelId: 'general', title: 'Build Node API', creatorName: 'user', status: 'todo',
      context: { goal: 'Create backend', artifacts: [], acceptanceCriteria: [], dependencies: [] },
    });

    const agent = await store.getAgent('agent-1');
    const summary = await buildOpenTaskSummary(agent!);
    expect(summary).toContain('Claimable unassigned tasks matching your role/capability:');
    expect(summary).toContain('Build Node API');
  });

  it('cap-limits the assigned tasks to 20', async () => {
    const store = getStore();
    await store.createAgent({ id: 'agent-1', name: 'engineer', runtime: 'claude', status: 'idle', createdAt: new Date().toISOString() });
    for (let i = 0; i < 25; i++) {
      await store.createTask({
        channelId: 'general', title: `Task ${i}`, creatorName: 'user', assigneeId: 'agent-1', status: 'todo',
        context: { goal: 'Batch', artifacts: [], acceptanceCriteria: [], dependencies: [] },
      });
    }

    const agent = await store.getAgent('agent-1');
    const summary = await buildOpenTaskSummary(agent!);
    expect(summary).toContain('Open tasks assigned to you:');
    // Should only show 20 tasks, not all 25
    const lines = summary!.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBe(20);
  });
});

describe('toTaskDelivery', () => {
  it('formats a task delivery message with all fields', () => {
    const task: Task = {
      id: 'task-1',
      channelId: 'general',
      title: 'Fix login bug',
      creatorName: 'user',
      status: 'todo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      context: {
        goal: 'Fix auth',
        background: 'Users cannot log in',
        handoffNotes: ['Checked the auth middleware'],
      },
    };

    const delivery = toTaskDelivery(task);
    expect(delivery.id).toContain('task-1');
    expect(delivery.channelId).toBe('task:task-1');
    expect(delivery.senderName).toBe('task-board');
    expect(delivery.content).toContain('Fix login bug');
    expect(delivery.content).toContain('Goal: Fix auth');
    expect(delivery.content).toContain('Background: Users cannot log in');
    expect(delivery.content).toContain('Checked the auth middleware');
    expect(delivery.content).toContain('crewden task read');
    expect(delivery.content).toContain('crewden task update');
  });
});
