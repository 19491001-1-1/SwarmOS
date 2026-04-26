import type { Agent, Machine, PatchAgentRequest } from '@mini-slock/shared';

const BUSY_STATUSES = new Set<Agent['status']>(['starting', 'running', 'working']);

export type AgentRuntimePatchError = {
  statusCode: 400 | 409;
  error: string;
};

export async function validateAgentRuntimePatch(
  agent: Agent,
  patch: PatchAgentRequest,
  getMachine: (id: string) => Promise<Machine | undefined>,
): Promise<AgentRuntimePatchError | undefined> {
  if (!patch.runtime && !patch.machineId) return undefined;
  if (patch.runtime && patch.runtime !== agent.runtime && BUSY_STATUSES.has(agent.status)) {
    return {
      statusCode: 409,
      error: `Cannot change runtime while agent is ${agent.status}. Stop the agent first.`,
    };
  }

  const runtime = patch.runtime ?? agent.runtime;
  const machineId = patch.machineId ?? agent.machineId;
  if (!machineId) return undefined;

  const machine = await getMachine(machineId);
  if (!machine) {
    return { statusCode: 400, error: `Machine ${machineId} not found` };
  }
  if (!machine.runtimes.includes(runtime)) {
    return { statusCode: 400, error: `Machine does not support runtime ${runtime}` };
  }
  return undefined;
}
