import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

export type DotenvLoadResult = {
  path?: string;
  loaded: string[];
};

export function loadNearestDotenv(startDir = process.cwd(), env: NodeJS.ProcessEnv = process.env): DotenvLoadResult {
  const path = findNearestDotenv(startDir);
  if (!path) return { loaded: [] };

  const loaded: string[] = [];
  const content = readFileSync(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] !== undefined) continue;
    env[parsed.key] = parsed.value;
    loaded.push(parsed.key);
  }

  return { path, loaded };
}

function findNearestDotenv(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function parseDotenvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;

  const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
  const equalIndex = body.indexOf('=');
  if (equalIndex <= 0) return undefined;

  const key = body.slice(0, equalIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;

  const rawValue = body.slice(equalIndex + 1).trim();
  return { key, value: unquote(rawValue) };
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;
  return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
