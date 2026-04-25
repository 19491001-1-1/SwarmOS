export type ParsedCommand =
  | { method: 'GET'; path: string; select?: 'agents' | 'task-summary' }
  | { method: 'POST'; path: string; body: unknown };

export async function callInternalApi(input: { command: ParsedCommand; agentId: string; serverUrl: string; token: string; fetchImpl: typeof fetch }): Promise<unknown> {
  const url = `${input.serverUrl.replace(/\/$/, '')}/internal/agent/${encodeURIComponent(input.agentId)}${input.command.path}`;
  const res = await input.fetchImpl(url, {
    method: input.command.method,
    headers: {
      Authorization: `Bearer ${input.token}`,
      'X-Agent-Id': input.agentId,
      ...(input.command.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: input.command.method === 'POST' ? JSON.stringify(input.command.body) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`request failed ${res.status}: ${text}`);
  return body;
}
