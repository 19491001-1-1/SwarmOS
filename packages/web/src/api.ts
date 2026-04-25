export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export const WEB_AUTH_TOKEN = (import.meta.env.VITE_WEB_AUTH_TOKEN ?? '').trim();
export const WEB_VERSION = (import.meta.env.VITE_APP_VERSION ?? '0.1.0').trim();
export const WEB_COMMIT_SHA = (import.meta.env.VITE_COMMIT_SHA ?? '').trim();

export type Channel = { id: string; name: string; createdAt: string };
export type Message = { id: string; channelId: string; senderName: string; content: string; agentId?: string; createdAt: string };
export type Agent = { id: string; name: string; displayName?: string; description?: string; runtime: string; model?: string; systemPrompt?: string; status: string; machineId?: string; autoStart?: boolean; createdAt: string };
export type AgentActivity = { id: string; agentId: string; type: 'thinking' | 'working' | 'output' | 'idle' | 'sending' | 'error'; detail?: string; createdAt: string };
export type Machine = { id: string; hostname: string; os: string; runtimes: string[]; status: string; connectedAt: string };
export type VersionInfo = { component: string; version: string; commit?: string; build?: string };

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (WEB_AUTH_TOKEN) headers['Authorization'] = `Bearer ${WEB_AUTH_TOKEN}`;
  return headers;
}

export function buildWsUrl(path: string): string {
  const base = API_BASE
    ? API_BASE.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  const url = `${base}${path}`;
  if (!WEB_AUTH_TOKEN) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(WEB_AUTH_TOKEN)}`;
}

export async function getChannels(): Promise<Channel[]> {
  const r = await fetch(`${API_BASE}/api/channels`, { headers: authHeaders() });
  return r.json();
}

export async function getHubVersion(): Promise<VersionInfo> {
  const r = await fetch(`${API_BASE}/api/version`, { headers: authHeaders() });
  return r.json();
}

export async function getMessages(channelId: string): Promise<Message[]> {
  const r = await fetch(`${API_BASE}/api/channels/${channelId}/messages`, { headers: authHeaders() });
  return r.json();
}

export async function sendMessage(channelId: string, senderName: string, content: string, agentId?: string): Promise<Message> {
  const r = await fetch(`${API_BASE}/api/channels/${channelId}/messages`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ senderName, content, agentId }),
  });
  return r.json();
}

export async function getAgents(): Promise<Agent[]> {
  const r = await fetch(`${API_BASE}/api/agents`, { headers: authHeaders() });
  return r.json();
}

export async function getAgentActivities(agentId: string): Promise<AgentActivity[]> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/activities`, { headers: authHeaders() });
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
  const r = await fetch(`${API_BASE}/api/agents`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchAgent(agentId: string, data: { machineId?: string; displayName?: string; model?: string; systemPrompt?: string; autoStart?: boolean }): Promise<Agent> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function startAgent(agentId: string): Promise<Agent> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/start`, { method: 'POST', headers: authHeaders() });
  return r.json();
}

export async function stopAgent(agentId: string): Promise<Agent> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/stop`, { method: 'POST', headers: authHeaders() });
  return r.json();
}

export async function getMachines(): Promise<Machine[]> {
  const r = await fetch(`${API_BASE}/api/machines`, { headers: authHeaders() });
  return r.json();
}
