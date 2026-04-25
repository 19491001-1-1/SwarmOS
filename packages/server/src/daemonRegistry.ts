import type { WebSocket } from 'ws';
import type { ServerToDaemon, WorkspaceEntry, WorkspaceError } from '@mini-slock/shared';

interface DaemonEntry {
  machineId: string;
  ws: WebSocket;
}

class DaemonRegistry {
  private connections = new Map<string, DaemonEntry>();
  private workspaceReads = new Map<string, {
    resolve: (result: WorkspaceEntry | WorkspaceError) => void;
    timeout: NodeJS.Timeout;
  }>();

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

  readWorkspace(machineId: string, agentId: string, requestId: string, relPath: string, timeoutMs = 5000): Promise<WorkspaceEntry | WorkspaceError> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Workspace read timed out', status: 504 });
      }, timeoutMs);

      this.workspaceReads.set(requestId, { resolve, timeout });
      const sent = this.send(machineId, { type: 'workspace:read', agentId, requestId, relPath });
      if (!sent) {
        clearTimeout(timeout);
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Machine not connected', status: 503 });
      }
    });
  }

  resolveWorkspaceRead(requestId: string, result: WorkspaceEntry | WorkspaceError): boolean {
    const pending = this.workspaceReads.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.workspaceReads.delete(requestId);
    pending.resolve(result);
    return true;
  }

  listConnectedMachineIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

export const daemonRegistry = new DaemonRegistry();
