import type { Agent, Task } from '@crewden/shared';

export function matchesAgentCapability(agent: Agent, task: Task): boolean {
  const haystack = [
    task.title,
    task.context?.goal,
    task.context?.goalObjective,
    task.context?.background,
    ...(task.context?.acceptanceCriteria ?? []),
    ...(task.context?.artifacts ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  const capabilities = [
    agent.name,
    agent.displayName,
    agent.description,
    ...(agent.organization?.roles ?? []),
    ...(agent.organization?.capabilities ?? []),
    ...(agent.organization?.responsibilities ?? []),
  ].filter(Boolean).map((item) => item!.toLowerCase());
  if (capabilities.length === 0) return false;
  return capabilities.some((capability) => capability.length >= 3 && (haystack.includes(capability) || capability.split(/\W+/).some((part) => part.length >= 4 && haystack.includes(part))));
}
