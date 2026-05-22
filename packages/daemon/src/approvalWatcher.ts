import { onApprovalResolved } from './actions.js';

// Helper for daemon runtime to call when a server message regarding approval arrives.
// The server will send { type: 'approval:resolved', approval } via websocket; the
// runtime should forward that message to this handler so the action can resume.
export async function handleServerApprovalMessage(msg: any) {
  if (!msg || msg.type !== 'approval:resolved' || !msg.approval) return undefined;
  try {
    const res = await onApprovalResolved(msg.approval);
    return res;
  } catch (e) {
    return undefined;
  }
}

export default { handleServerApprovalMessage };
