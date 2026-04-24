import { execa } from 'execa';
import type { RuntimeId } from '@mini-slock/shared';

export type DetectedRuntime = {
  id: RuntimeId;
  version: string;
};

const RUNTIME_COMMANDS: Record<RuntimeId, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

async function detectRuntime(id: RuntimeId): Promise<DetectedRuntime | null> {
  try {
    const result = await execa(RUNTIME_COMMANDS[id], ['--version'], {
      timeout: 5000,
      reject: false,
    });
    const output = (result.stdout || result.stderr || '').trim();
    if (result.exitCode === 0 || output) {
      return { id, version: output || 'unknown' };
    }
    return null;
  } catch {
    return null;
  }
}

export async function detectRuntimes(): Promise<DetectedRuntime[]> {
  const results = await Promise.all(
    (['claude', 'codex', 'gemini'] as RuntimeId[]).map(detectRuntime)
  );
  return results.filter((r): r is DetectedRuntime => r !== null);
}
