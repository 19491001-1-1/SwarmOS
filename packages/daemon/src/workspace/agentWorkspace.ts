import { constants } from 'fs';
import { access, mkdir, readFile, realpath, readdir, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { isAbsolute, join, normalize, resolve, sep } from 'path';
import type { AgentRuntimeConfig, WorkspaceEntry, WorkspaceError } from '@crewden/shared';

export const MAX_WORKSPACE_TEXT_BYTES = 1024 * 1024;

const DEFAULT_NOTES: Record<string, string> = {
  'user-preferences.md': '# User Preferences\n\n- No preferences recorded yet.\n',
  'channels.md': '# Channels\n\n- No channel notes recorded yet.\n',
  'work-log.md': '# Work Log\n\n- No work logged yet.\n',
};

export type AgentWorkspaceInfo = {
  root: string;
  memoryPath: string;
  notesDir: string;
};

export function getAgentWorkspaceRoot(agentId: string, baseDir?: string): string {
  const root = baseDir ?? process.env.CREWDEN_AGENTS_DIR ?? join(homedir(), '.crewden', 'agents');
  return join(root, agentId);
}

export async function ensureAgentWorkspace(agentId: string, config: AgentRuntimeConfig, baseDir?: string): Promise<AgentWorkspaceInfo> {
  const root = getAgentWorkspaceRoot(agentId, baseDir);
  await mkdir(root, { recursive: true });
  const memoryPath = await ensureMemoryFile(agentId, config, root);
  const notesDir = await ensureNotes(root);
  return { root, memoryPath, notesDir };
}

export async function ensureMemoryFile(agentId: string, config: AgentRuntimeConfig, root = getAgentWorkspaceRoot(agentId)): Promise<string> {
  const memoryPath = join(root, 'MEMORY.md');
  if (await exists(memoryPath)) return memoryPath;
  const displayName = config.displayName ?? config.name ?? agentId;
  const role = config.description ?? config.systemPrompt ?? 'General-purpose crewden agent.';
  await writeFile(memoryPath, [
    `# ${displayName}`,
    '',
    '## Role',
    role,
    '',
    '## Key Knowledge',
    '- No notes yet.',
    '',
    '## Active Context',
    '- First startup.',
    '',
    '## Collaboration',
    '- Use `crewden` CLI for channel messages, DMs, tasks, and delegation when available.',
    '- Keep durable notes in `notes/`.',
    '',
  ].join('\n'));
  return memoryPath;
}

export async function ensureNotes(root: string): Promise<string> {
  const notesDir = join(root, 'notes');
  await mkdir(notesDir, { recursive: true });
  await Promise.all(Object.entries(DEFAULT_NOTES).map(async ([name, content]) => {
    const path = join(notesDir, name);
    if (await exists(path)) return;
    await writeFile(path, content);
  }));
  return notesDir;
}

export async function safeResolveAgentPath(agentId: string, relPath: string, baseDir?: string): Promise<string> {
  const root = getAgentWorkspaceRoot(agentId, baseDir);
  const safePath = normalize(relPath || '.');
  if (isAbsolute(relPath) || safePath === '..' || safePath.startsWith(`..${sep}`) || safePath.includes(`${sep}..${sep}`)) {
    throw Object.assign(new Error('Path traversal is not allowed'), { status: 403 });
  }

  const rootReal = await realpath(root);
  const candidate = resolve(rootReal, safePath);
  const parentReal = await realpathParent(candidate, rootReal);
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${sep}`)) {
    throw Object.assign(new Error('Path traversal is not allowed'), { status: 403 });
  }

  return candidate;
}

export async function readAgentWorkspace(agentId: string, relPath: string, baseDir?: string): Promise<WorkspaceEntry | WorkspaceError> {
  const displayPath = normalize(relPath || '.');
  try {
    const targetPath = await safeResolveAgentPath(agentId, relPath, baseDir);
    const info = await stat(targetPath);
    const path = displayPath === '.' ? '' : displayPath;

    if (info.isDirectory()) {
      const entries = await readdir(targetPath, { withFileTypes: true });
      const children = await Promise.all(entries.map(async (entry) => {
        const childPath = join(targetPath, entry.name);
        const childInfo = await stat(childPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'dir' as const : 'file' as const,
          size: childInfo.size,
          modifiedAt: childInfo.mtime.toISOString(),
        };
      }));
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { type: 'dir', path, children };
    }

    if (!info.isFile()) {
      return { type: 'error', error: 'Workspace path is not a file or directory', status: 400 };
    }

    const buffer = await readFile(targetPath);
    if (isBinary(buffer)) {
      return { type: 'file', path, content: '', binary: true, truncated: false };
    }
    const truncated = buffer.byteLength > MAX_WORKSPACE_TEXT_BYTES;
    const content = buffer.subarray(0, MAX_WORKSPACE_TEXT_BYTES).toString('utf8');
    return { type: 'file', path, content, truncated };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const status = (err as { status?: number }).status;
    if (status) return { type: 'error', error: err instanceof Error ? err.message : 'Workspace read failed', status };
    if (code === 'ENOENT') return { type: 'error', error: 'Workspace path not found', status: 404 };
    return { type: 'error', error: err instanceof Error ? err.message : 'Failed to read workspace', status: 500 };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function realpathParent(targetPath: string, rootReal: string): Promise<string> {
  let current = targetPath;
  while (current !== rootReal && current.startsWith(`${rootReal}${sep}`)) {
    try {
      return await realpath(current);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      current = resolve(current, '..');
    }
  }
  return await realpath(current);
}

function isBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.byteLength, 8000);
  for (let i = 0; i < length; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
