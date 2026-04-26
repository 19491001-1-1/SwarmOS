import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const MACHINE_ID_FILE = join(os.homedir(), '.crewden', 'machine-id');

export async function getMachineId(): Promise<string> {
  const configured = process.env.CREWDEN_MACHINE_ID?.trim();
  if (configured) return configured;

  try {
    const existing = (await readFile(MACHINE_ID_FILE, 'utf8')).trim();
    if (existing) return existing;
  } catch {
    // First run or unreadable legacy state: create a local identity below.
  }

  const machineId = `machine-${randomUUID()}`;
  await mkdir(join(os.homedir(), '.crewden'), { recursive: true });
  await writeFile(MACHINE_ID_FILE, `${machineId}\n`, { flag: 'wx' }).catch(async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EEXIST') return;
    throw err;
  });

  return (await readFile(MACHINE_ID_FILE, 'utf8')).trim();
}
