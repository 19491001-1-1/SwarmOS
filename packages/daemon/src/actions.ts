import { DaemonActionRequestSchema } from '@crewden/shared';
import { lockManager } from './locks.js';
import { runWithTimeout } from './timeouts.js';
import { assessExecCommand } from './riskPolicy.js';
import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import { mkdir, readdir, rm, readFile, writeFile } from 'fs/promises';
import { dirname, normalize } from 'path';

// Map of approvalId -> original request to resume after approval
const pendingActions = new Map<string, any>();

/** Normalize a file path to prevent lock bypass via path aliasing */
function normalizedPath(path: string): string {
  try { return normalize(path); } catch { return path; }
}

async function performExecution(execReq: any, options?: { bypassApprovalCheck?: boolean }) {
  const timeoutSeconds = Number(execReq.params?.timeoutSeconds ?? 60);
  let execPromise: Promise<any> & { child?: any };

  if (execReq.tool === 'exec_cmd') {
    const command = execReq.params?.command;
    if (typeof command !== 'string') {
      return {
        action_id: execReq.action_id,
        status: 'error',
        error_type: 'InvalidCommand',
        stderr: 'exec_cmd requires params.command string',
        timestamp: new Date().toISOString(),
      };
    }

    // Only actually execute when explicitly allowed to avoid unsafe runs in CI/dev
    if (process.env.E2E_ALLOW_EXEC !== 'true') {
      // simulated execution
      execPromise = (async () => ({ stdout: `[simulated] ${command}`, stderr: '' }))() as Promise<any>;
    } else {
      execPromise = new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (b) => { stdout += b.toString(); });
        child.stderr?.on('data', (b) => { stderr += b.toString(); });
        child.on('error', (err) => reject(err));
        child.on('close', (code, signal) => resolve({ stdout, stderr, code, signal }));
        execPromise.child = child;
      }) as Promise<any> & { child?: any };
    }
  } else if (execReq.tool === 'dir_mkdir') {
    const dirPath = execReq.params?.path;
    if (typeof dirPath !== 'string') {
      return { action_id: execReq.action_id, status: 'error', error_type: 'InvalidParam', stderr: 'dir_mkdir requires params.path string', timestamp: new Date().toISOString() };
    }
    execPromise = (async () => {
      await mkdir(dirPath, { recursive: true });
      return { stdout: `created directory: ${dirPath}`, stderr: '' };
    })() as Promise<any>;
  } else if (execReq.tool === 'dir_readdir') {
    const dirPath = execReq.params?.path ?? '.';
    execPromise = (async () => {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const listing = entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n');
      return { stdout: listing, stderr: '' };
    })() as Promise<any>;
  } else if (execReq.tool === 'dir_rm') {
    const dirPath = execReq.params?.path;
    if (typeof dirPath !== 'string') {
      return { action_id: execReq.action_id, status: 'error', error_type: 'InvalidParam', stderr: 'dir_rm requires params.path string', timestamp: new Date().toISOString() };
    }
    execPromise = (async () => {
      await rm(dirPath, { recursive: true, force: true });
      return { stdout: `removed: ${dirPath}`, stderr: '' };
    })() as Promise<any>;
  } else if (execReq.tool === 'file_read') {
    const targetPath = execReq.target_path;
    if (typeof targetPath !== 'string') {
      return { action_id: execReq.action_id, status: 'error', error_type: 'InvalidParam', stderr: 'file_read requires target_path string', timestamp: new Date().toISOString() };
    }
    if (process.env.E2E_ALLOW_EXEC !== 'true') {
      execPromise = (async () => ({ stdout: `[simulated] read ${targetPath}`, stderr: '' }))() as Promise<any>;
    } else {
      execPromise = (async () => {
        const content = await readFile(targetPath, 'utf-8');
        return { stdout: content, stderr: '' };
      })() as Promise<any>;
    }
  } else if (execReq.tool === 'file_write') {
    const targetPath = execReq.target_path;
    const content = typeof execReq.params?.content === 'string' ? execReq.params.content : (typeof execReq.params?.command === 'string' ? execReq.params.command : '');
    if (typeof targetPath !== 'string') {
      return { action_id: execReq.action_id, status: 'error', error_type: 'InvalidParam', stderr: 'file_write requires target_path string', timestamp: new Date().toISOString() };
    }
    if (process.env.E2E_ALLOW_EXEC !== 'true') {
      execPromise = (async () => ({ stdout: `[simulated] wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${targetPath}`, stderr: '' }))() as Promise<any>;
    } else {
      execPromise = (async () => {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, 'utf-8');
        return { stdout: `wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${targetPath}`, stderr: '' };
      })() as Promise<any>;
    }
  } else {
    execPromise = (async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { stdout: 'ok', stderr: '' };
    })() as Promise<any>;
  }

  const res = await runWithTimeout(execPromise, timeoutSeconds * 1000, () => {
    try {
      const maybeChild = execPromise.child;
      if (maybeChild && typeof maybeChild.kill === 'function') {
        maybeChild.kill('SIGKILL');
      }
    } catch (_) {}
  });

  if (!res.ok) {
    return {
      action_id: execReq.action_id,
      status: 'timed_out',
      error_type: 'TimeoutError',
      timestamp: new Date().toISOString(),
    };
  }

  // release lock if any
  if (execReq.tool === 'file_write' && execReq.target_path) {
    try { lockManager.release(normalizedPath(execReq.target_path), execReq.agent_id ?? 'unknown'); } catch (_) {}
  }

  return {
    action_id: execReq.action_id,
    status: 'success',
    stdout: res.value.stdout,
    stderr: res.value.stderr,
    timestamp: new Date().toISOString(),
  };
}

async function createServerApproval(payload: { action_id?: string; agent_id?: string; reason?: string }) {
  const server = process.env.SERVER_URL ?? process.env.SERVER_API_URL ?? 'http://localhost:3000';
  try {
    const fetchImpl = globalThis.fetch ?? (await import('node-fetch')).default;
    const res = await fetchImpl(`${server.replace(/\/$/, '')}/api/v1/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action_id: payload.action_id, agent_id: payload.agent_id, reason: payload.reason }),
    });
    if (!res.ok) throw new Error('create approval failed');
    const json = await res.json();
    return json;
  } catch (e) {
    // best-effort: return undefined to indicate local-only approval
    return undefined;
  }
}

export async function onApprovalResolved(approval: { id: string; status: string }) {
  const req = pendingActions.get(approval.id);
  if (!req) return false;
  // remove pending before executing
  pendingActions.delete(approval.id);
  if (approval.status !== 'approved') {
    // return a rejected result object for callers
    return {
      action_id: req.action_id,
      status: 'rejected',
      approval_id: approval.id,
      timestamp: new Date().toISOString(),
    };
  }
  // call performExecution to actually run the previously pending action
  const result = await performExecution(req, { bypassApprovalCheck: true });
  if (result && typeof result === 'object') {
    return { ...result, approval_id: approval.id };
  }
  return result;
}

// Execute an action with basic lock/timeout/risk handling. This is a skeleton
// to be replaced by real drivers. Returns an object conforming to
// DaemonActionResult semantics.
export async function executeAction(action: unknown) {
  const parsed = DaemonActionRequestSchema.safeParse(action);
  if (!parsed.success) {
    return {
      action_id: (action as any)?.action_id ?? 'unknown',
      status: 'error',
      error_type: 'InvalidRequest',
      stderr: JSON.stringify(parsed.error.issues),
      timestamp: new Date().toISOString(),
    };
  }

  const req = parsed.data;

  // High-risk detection for exec commands (last-line daemon defense)
  const cmd = req.params?.command;
  const riskResult = typeof cmd === "string" ? assessExecCommand(cmd) : null;
  if (req.tool === "exec_cmd" && riskResult?.dangerous && !(req as any).__approved) {
    // Return risk_detected first, then attempt to create approval on server
    const created = await createServerApproval({ action_id: req.action_id, agent_id: req.agent_id, reason: `exec: ${cmd}` });
    const approvalId = (created && created.id) ? created.id : ('ap_' + nanoid());
    // store the original request for resume when approval arrives
    pendingActions.set(approvalId, req);
    return {
      action_id: req.action_id,
      status: 'risk_detected',
      approval_id: approvalId,
      timestamp: new Date().toISOString(),
    };
  }

  // If this is a file write, try acquiring a lock before executing.
  if (req.tool === 'file_write' && req.target_path) {
    const npath = normalizedPath(req.target_path);
    const lock = lockManager.acquire(npath, req.agent_id ?? 'unknown');
    if (!lock.granted) {
      // Return waiting_lock — the server-side actionOrchestrator will retry
      // when the lock is released (via lock:update event from daemonClient).
      return {
        action_id: req.action_id,
        status: 'waiting_lock',
        lock_owner: lock.currentOwner,
        timestamp: new Date().toISOString(),
      };
    }
  }

  return performExecution(req);
}

export { pendingActions };
