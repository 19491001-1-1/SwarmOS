const BASE = '';

export type Channel = { id: string; name: string; createdAt: string };
export type Message = { id: string; channelId: string; senderName: string; content: string; agentId?: string; createdAt: string };
export type Agent = { id: string; name: string; displayName?: string; runtime: string; model?: string; status: string; machineId?: string; createdAt: string };
export type Machine = { id: string; hostname: string; os: string; runtimes: string[]; status: string; connectedAt: string };

export async function getChannels(): Promise<Channel[]> {
  const r = await fetch(`${BASE}/api/channels`);
  return r.json();
}

export async function getMessages(channelId: string): Promise<Message[]> {
  const r = await fetch(`${BASE}/api/channels/${channelId}/messages`);
  return r.json();
}

export async function sendMessage(channelId: string, senderName: string, content: string, agentId?: string): Promise<Message> {
  const r = await fetch(`${BASE}/api/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, content, agentId }),
  });
  return r.json();
}

export async function getAgents(): Promise<Agent[]> {
  const r = await fetch(`${BASE}/api/agents`);
  return r.json();
}

export async function createAgent(data: {
  name: string;
  displayName?: string;
  runtime: string;
  model?: string;
  systemPrompt?: string;
  machineId?: string;
}): Promise<Agent> {
  const r = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchAgent(agentId: string, data: { machineId?: string; displayName?: string; model?: string; systemPrompt?: string }): Promise<Agent> {
  const r = await fetch(`${BASE}/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function startAgent(agentId: string): Promise<Agent> {
  const r = await fetch(`${BASE}/api/agents/${agentId}/start`, { method: 'POST' });
  return r.json();
}

export async function stopAgent(agentId: string): Promise<Agent> {
  const r = await fetch(`${BASE}/api/agents/${agentId}/stop`, { method: 'POST' });
  return r.json();
}

export async function getMachines(): Promise<Machine[]> {
  const r = await fetch(`${BASE}/api/machines`);
  return r.json();
}
