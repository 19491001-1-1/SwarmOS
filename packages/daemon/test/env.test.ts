import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadNearestDotenv } from '../src/env.js';

describe('loadNearestDotenv', () => {
  it('loads nearest ancestor .env without overriding existing values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crewden-env-'));
    const child = join(root, 'packages', 'daemon');
    await mkdir(child, { recursive: true });
    await writeFile(join(root, '.env'), [
      'GEMINI_API_KEY=from-env',
      'EXISTING=from-env',
      'QUOTED="hello world"',
      "SINGLE='plain value'",
      'export EXPORTED=yes',
      '# ignored',
      '',
    ].join('\n'));

    const env: NodeJS.ProcessEnv = { EXISTING: 'from-shell' };
    const result = loadNearestDotenv(child, env);

    expect(result.path).toBe(join(root, '.env'));
    expect(result.loaded).toEqual(['GEMINI_API_KEY', 'QUOTED', 'SINGLE', 'EXPORTED']);
    expect(env.GEMINI_API_KEY).toBe('from-env');
    expect(env.EXISTING).toBe('from-shell');
    expect(env.QUOTED).toBe('hello world');
    expect(env.SINGLE).toBe('plain value');
    expect(env.EXPORTED).toBe('yes');
  });
});
