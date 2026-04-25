import { describe, expect, it } from 'vitest';
import type { Agent } from '@mini-slock/shared';
import { buildClarifyingQuestions, classifyMessageIntent, inferGoalRiskLevel, recommendAgentsForGoal } from '../src/goalAlignment.js';

const baseAgent: Agent = {
  id: 'agent-base',
  name: 'base',
  runtime: 'codex',
  status: 'inactive',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('classifyMessageIntent', () => {
  it('classifies broad multi-step requests as goals', () => {
    expect(classifyMessageIntent({ content: '帮我做一个 Mac 全局语音输入法，从需求到技术方案都安排一下' })).toBe('goal');
    expect(classifyMessageIntent({ content: 'Plan and ship an MVP roadmap with engineering and QA review' })).toBe('goal');
  });

  it('classifies narrow actions as tasks and ordinary conversation as chat', () => {
    expect(classifyMessageIntent({ content: '修复一下输入框的回车问题' })).toBe('task');
    expect(classifyMessageIntent({ content: 'hello, how are you?' })).toBe('chat');
  });
});

describe('goal alignment helpers', () => {
  it('infers risk and missing clarification questions', () => {
    expect(inferGoalRiskLevel({ content: '上线生产环境并处理付款逻辑' })).toBe('high');
    expect(inferGoalRiskLevel({ content: '整理一份产品方案' })).toBe('low');
    expect(buildClarifyingQuestions({ content: '帮我做一个外卖 App MVP' })).toContain('What does success look like for this goal?');
  });

  it('recommends owner and reviewer agents with reasons and gaps', () => {
    const agents: Agent[] = [
      {
        ...baseAgent,
        id: 'pm',
        name: 'pm',
        displayName: 'Product Manager',
        organization: { roles: ['Product Manager'], capabilities: ['requirements planning'] },
      },
      {
        ...baseAgent,
        id: 'eng',
        name: 'engineer',
        displayName: 'Engineer',
        organization: { roles: ['Engineer'], capabilities: ['implementation'] },
      },
      {
        ...baseAgent,
        id: 'qa',
        name: 'qa',
        displayName: 'QA',
        organization: { roles: ['QA'], capabilities: ['quality review'] },
      },
    ];
    const result = recommendAgentsForGoal('Ship a Mac MVP', agents);
    expect(result.ownerAgentIds).toEqual(['pm', 'eng']);
    expect(result.reviewerAgentIds).toEqual(['qa']);
    expect(result.reasons.pm).toContain('planning');
    expect(result.gaps).toEqual([]);
  });
});
