import type { Agent, AgentRuntimeConfig, Machine } from '@mini-slock/shared';

export function toRuntimeConfig(agent: Agent): AgentRuntimeConfig {
  return {
    runtime: agent.runtime,
    model: agent.model,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
  };
}

export function resolveStartMachineId(input: {
  agent: Agent;
  machines: Machine[];
  connectedMachineIds: Set<string>;
}): string | undefined {
  const { agent, machines, connectedMachineIds } = input;

  if (agent.machineId && connectedMachineIds.has(agent.machineId)) {
    return agent.machineId;
  }

  return machines.find((machine) => connectedMachineIds.has(machine.id) && machine.runtimes.includes(agent.runtime))?.id;
}

export function resetAgentStatusForRestart(status: Agent['status']): Agent['status'] {
  return ['starting', 'running', 'working', 'idle'].includes(status) ? 'inactive' : status;
}
