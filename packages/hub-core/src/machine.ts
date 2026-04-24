import type { Machine } from '@mini-slock/shared';

export function findExistingMachineId(input: {
  machines: Machine[];
  hostname: string;
  os: string;
}): string | undefined {
  const { machines, hostname, os } = input;
  return machines.find((machine) => machine.hostname === hostname && machine.os === os)?.id;
}

export function findDuplicateMachineIds(input: {
  machines: Machine[];
  targetMachineId: string;
  hostname: string;
  os: string;
}): string[] {
  const { machines, targetMachineId, hostname, os } = input;
  return machines
    .filter((machine) => machine.id !== targetMachineId && machine.hostname === hostname && machine.os === os)
    .map((machine) => machine.id);
}
