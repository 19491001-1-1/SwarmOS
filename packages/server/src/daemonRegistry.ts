import type { WebSocket } from 'ws';
import type { ServerToDaemon } from '@mini-slock/shared';

interface DaemonEntry {
  machineId: string;
  ws: WebSocket;
}

class DaemonRegistry {
  private connections = new Map<string, DaemonEntry>();

  register(machineId: string, ws: WebSocket): void {
    this.connections.set(machineId, { machineId, ws });
  }

  unregister(machineId: string): void {
    this.connections.delete(machineId);
  }

  getByMachineId(machineId: string): DaemonEntry | undefined {
    return this.connections.get(machineId);
  }

  send(machineId: string, msg: ServerToDaemon): boolean {
    const entry = this.connections.get(machineId);
    if (!entry || entry.ws.readyState !== 1) return false;
    entry.ws.send(JSON.stringify(msg));
    return true;
  }

  listConnectedMachineIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

export const daemonRegistry = new DaemonRegistry();
