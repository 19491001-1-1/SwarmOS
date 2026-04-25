import { mkdtemp, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { runAgentCli } from '../src/agentCli.js';

describe('agent-facing xoxiang CLI', () => {
  async function run(argv: string[], fetchImpl: typeof fetch = okFetch({ ok: true })) {
    const dir = await mkdtemp(join(tmpdir(), 'xoxiang-agent-cli-'));
    const tokenFile = join(dir, 'agent-token');
    await writeFile(tokenFile, 'token-1\n');
    let stdout = '';
    let stderr = '';
    const code = await runAgentCli(
      argv,
      {
        XOXIANG_AGENT_ID: 'agent-1',
        XOXIANG_SERVER_URL: 'http://hub.test',
        XOXIANG_AGENT_TOKEN_FILE: tokenFile,
      },
      {
        stdout: { write: (chunk: string | Uint8Array) => { stdout += String(chunk); return true; } },
        stderr: { write: (chunk: string | Uint8Array) => { stderr += String(chunk); return true; } },
        fetch: fetchImpl,
      }
    );
    return { code, stdout, stderr };
  }

  it('calls auth whoami', async () => {
    const fetchImpl = okFetch({ agent: { id: 'agent-1', name: 'bot' } });
    const result = await run(['auth', 'whoami'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/auth/whoami',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1', 'X-Agent-Id': 'agent-1' }),
      })
    );
  });

  it('sends channel messages', async () => {
    const fetchImpl = okFetch({ id: 'msg-1' });
    const result = await run(['message', 'send', '--channel', 'general', '--content', 'hello'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/messages/send',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ channel: 'general', content: 'hello' }) })
    );
  });

  it('sends DMs', async () => {
    const fetchImpl = okFetch({ id: 'dm-1' });
    const result = await run(['dm', 'send', '--to', 'target', '--content', 'secret'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/dms/send',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'target', content: 'secret' }) })
    );
  });

  it('delegates with wake flag', async () => {
    const fetchImpl = okFetch({ id: 'delegation-1' });
    const result = await run(['agent', 'delegate', '--to', 'target', '--content', 'work', '--start-if-inactive'], fetchImpl);

    expect(result.code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://hub.test/internal/agent/agent-1/delegate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'target', content: 'work', startIfInactive: true }) })
    );
  });
});

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}
