import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, symlink, writeFile } from 'fs/promises';
import { join, normalize } from 'path';
import { tmpdir } from 'os';
import {
  ensureAgentWorkspace,
  getAgentWorkspaceRoot,
  readAgentWorkspace,
  safeResolveAgentPath,
} from '../src/workspace/agentWorkspace.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'crewden-workspace-test-'));
}

describe('agent workspace', () => {
  it('creates MEMORY.md and default notes without overwriting memory', async () => {
    const root = await tempRoot();
    const config = { runtime: 'claude' as const, name: 'bot', displayName: 'Bot', description: 'Research agent' };

    const info = await ensureAgentWorkspace('agent-1', config, root);
    expect(info.root).toBe(getAgentWorkspaceRoot('agent-1', root));
    expect(await readFile(join(info.root, 'MEMORY.md'), 'utf8')).toContain('# Bot');
    expect(await readFile(join(info.root, 'notes', 'work-log.md'), 'utf8')).toContain('# Work Log');

    await writeFile(join(info.root, 'MEMORY.md'), 'custom memory');
    await ensureAgentWorkspace('agent-1', config, root);
    expect(await readFile(join(info.root, 'MEMORY.md'), 'utf8')).toBe('custom memory');
  });

  it('respects CREWDEN_AGENTS_DIR when no base dir is supplied', () => {
    const previous = process.env.CREWDEN_AGENTS_DIR;
    process.env.CREWDEN_AGENTS_DIR = '/tmp/custom-crewden-agents';
    try {
      expect(getAgentWorkspaceRoot('agent-1')).toBe(normalize('/tmp/custom-crewden-agents/agent-1'));
    } finally {
      if (previous === undefined) delete process.env.CREWDEN_AGENTS_DIR;
      else process.env.CREWDEN_AGENTS_DIR = previous;
    }
  });

  it('blocks path traversal and symlink escape', async () => {
    const root = await tempRoot();
    const config = { runtime: 'claude' as const, name: 'bot' };
    const info = await ensureAgentWorkspace('agent-1', config, root);

    await expect(safeResolveAgentPath('agent-1', '../outside', root)).rejects.toThrow('Path traversal');

    const outside = await tempRoot();
    await writeFile(join(outside, 'secret.txt'), 'secret');
    if (process.platform === 'win32') {
      await symlink(outside, join(info.root, 'outside-link'), 'junction');
    } else {
      await symlink(outside, join(info.root, 'outside-link'));
    }
    await expect(safeResolveAgentPath('agent-1', 'outside-link/secret.txt', root)).rejects.toThrow('Path traversal');
  });

  it('reads directories, text files, and binary files', async () => {
    const root = await tempRoot();
    const config = { runtime: 'claude' as const, name: 'bot' };
    const info = await ensureAgentWorkspace('agent-1', config, root);
    await writeFile(join(info.root, 'hello.txt'), 'hello');
    await writeFile(join(info.root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));

    const dir = await readAgentWorkspace('agent-1', '', root);
    expect(dir).toMatchObject({ type: 'dir', path: '' });
    if (dir.type === 'dir') {
      expect(dir.children.map((child) => child.name)).toContain('hello.txt');
    }

    await expect(readAgentWorkspace('agent-1', 'hello.txt', root)).resolves.toMatchObject({
      type: 'file',
      path: 'hello.txt',
      content: 'hello',
    });
    await expect(readAgentWorkspace('agent-1', 'binary.bin', root)).resolves.toMatchObject({
      type: 'file',
      binary: true,
      content: '',
    });
  });
});
