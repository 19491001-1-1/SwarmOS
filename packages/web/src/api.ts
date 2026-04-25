export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export const WEB_AUTH_TOKEN = (import.meta.env.VITE_WEB_AUTH_TOKEN ?? '').trim();
export const WEB_VERSION = (import.meta.env.VITE_APP_VERSION ?? '0.6.0').trim();
export const WEB_COMMIT_SHA = (import.meta.env.VITE_COMMIT_SHA ?? '').trim();

export type Channel = { id: string; name: string; createdAt: string };
export type Message = { id: string; channelId: string; senderName: string; content: string; agentId?: string; createdAt: string };
export type SearchMessageResult = Message & { channelName: string };
export type AgentOrganization = { department?: string; roles?: string[]; capabilities?: string[]; responsibilities?: string[]; managerId?: string; backupAgentIds?: string[]; availability?: 'available' | 'unavailable' | 'overloaded' };
export type Agent = { id: string; name: string; displayName?: string; description?: string; runtime: string; model?: string; systemPrompt?: string; envVars?: Record<string, string>; organization?: AgentOrganization; status: string; machineId?: string; autoStart?: boolean; createdAt: string };
export type AgentActivity = { id: string; agentId: string; type: 'thinking' | 'working' | 'output' | 'idle' | 'sending' | 'error'; detail?: string; createdAt: string };
export type DirectMessage = { id: string; fromAgentId: string; toAgentId: string; content: string; createdAt: string };
export type DirectMessageThread = { otherAgentId: string; lastMessage: DirectMessage };
export type WorkspaceFile = { name: string; type: 'file' | 'dir'; size?: number; modifiedAt?: string };
export type WorkspaceEntry =
  | { type: 'dir'; path: string; children: WorkspaceFile[] }
  | { type: 'file'; path: string; content: string; truncated?: boolean; binary?: boolean };
export type AgentDelegation = { id: string; fromAgentId: string; toAgentId: string; content: string; status: 'queued' | 'delivered' | 'started' | 'failed'; error?: string; createdAt: string };
export type Machine = { id: string; hostname: string; os: string; runtimes: string[]; status: string; connectedAt: string };
export type VersionInfo = { component: string; version: string; commit?: string; build?: string };
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Task = { id: string; channelId: string; messageId?: string; title: string; status: TaskStatus; creatorName: string; assigneeId?: string; createdAt: string; updatedAt: string };
export type ReminderStatus = 'pending' | 'triggered' | 'cancelled';
export type Reminder = { id: string; agentId: string; channelId: string; message: string; triggerAt: string; status: ReminderStatus; createdAt: string };

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

export async function createChannel(name: string): Promise<Channel> {
  const r = await fetch(`${API_BASE}/api/channels`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Create channel failed');
  return r.json();
}

export async function deleteChannel(channelId: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Delete channel failed');
}

export async function searchMessages(q: string, limit = 20): Promise<{ messages: SearchMessageResult[] }> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const r = await fetch(`${API_BASE}/api/search?${params.toString()}`, { headers: authHeaders() });
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
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Send message failed');
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

export async function getAgentWorkspace(agentId: string, relPath = ''): Promise<WorkspaceEntry> {
  const query = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/workspace${query}`, { headers: authHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Workspace request failed (${r.status})`);
  }
  return r.json();
}

export async function createAgent(data: {
  name: string;
  displayName?: string;
  description?: string;
  runtime: string;
  model?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  organization?: AgentOrganization;
  machineId?: string;
}): Promise<Agent> {
  const r = await fetch(`${API_BASE}/api/agents`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchAgent(agentId: string, data: { machineId?: string; displayName?: string; description?: string; model?: string; systemPrompt?: string; envVars?: Record<string, string>; organization?: AgentOrganization; autoStart?: boolean }): Promise<Agent> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function getAgentDmThreads(agentId: string): Promise<DirectMessageThread[]> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/dms`, { headers: authHeaders() });
  return r.json();
}

export async function getAgentDirectMessages(agentId: string, otherId: string): Promise<DirectMessage[]> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/dms/${encodeURIComponent(otherId)}`, { headers: authHeaders() });
  return r.json();
}

export async function sendAgentDirectMessage(agentId: string, otherId: string, content: string): Promise<DirectMessage> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/dms/${encodeURIComponent(otherId)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content }),
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

export async function getTasks(filter: { channelId?: string; status?: TaskStatus } = {}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filter.channelId) params.set('channelId', filter.channelId);
  if (filter.status) params.set('status', filter.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const r = await fetch(`${API_BASE}/api/tasks${query}`, { headers: authHeaders() });
  return r.json();
}

export async function createTask(data: { channelId?: string; title: string; assigneeId?: string; creatorName?: string }): Promise<Task> {
  const r = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchTask(taskId: string, data: { status?: TaskStatus; assigneeId?: string }): Promise<Task> {
  const r = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  await fetch(`${API_BASE}/api/tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
}

export async function messageToTask(messageId: string, data: { assigneeId?: string; creatorName?: string } = {}): Promise<Task> {
  const r = await fetch(`${API_BASE}/api/messages/${messageId}/to-task`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function getAgentReminders(agentId: string): Promise<Reminder[]> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/reminders`, { headers: authHeaders() });
  return r.json();
}

export async function createAgentReminder(agentId: string, data: { channelId?: string; message: string; triggerAt: string }): Promise<Reminder> {
  const r = await fetch(`${API_BASE}/api/agents/${agentId}/reminders`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function cancelReminder(reminderId: string): Promise<Reminder> {
  const r = await fetch(`${API_BASE}/api/reminders/${reminderId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'cancelled' }),
  });
  return r.json();
}
