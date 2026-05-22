/**
 * Server-side risk action strategy.
 *
 * Classifies commands by risk level so the server can independently flag
 * dangerous actions before dispatching to the daemon. The daemon performs
 * a second (last-line) check, but the server is the primary policy engine.
 */

export type RiskAssessment = {
  level: 'low' | 'medium' | 'high';
  reason: string;
  requiresApproval: boolean;
};

const DANGER_PATTERNS: Array<{ pattern: RegExp; level: RiskAssessment['level']; reason: string }> = [
  { pattern: /(?:\brm\b.*-(?:r|f|rf|fr)\b|rm\s+-[^-]*[rf])/i, level: 'high', reason: 'recursive file removal' },
  { pattern: /(?::>|2>&1.*>)/i, level: 'high', reason: 'stdout redirection could overwrite files' },
  { pattern: /\bsudo\b/i, level: 'high', reason: 'privilege escalation (sudo)' },
  { pattern: /\bchmod\s+777\b/i, level: 'high', reason: 'world-writable permission change' },
  { pattern: /\bchown\b/i, level: 'high', reason: 'file ownership change' },
  { pattern: /\bmkfs\b/i, level: 'high', reason: 'filesystem formatting' },
  { pattern: /\b(mv|cp)\b.*\/(etc|bin|sbin|boot|dev)\//i, level: 'high', reason: 'modifying system directories' },
  { pattern: /\b(git\s+push\s+--force|git\s+push\s+-f)\b/i, level: 'medium', reason: 'force push to remote' },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/i, level: 'medium', reason: 'docker resource removal' },
  { pattern: /\bnpm\s+(unpublish|deprecate)\b/i, level: 'medium', reason: 'npm package registry mutation' },
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, level: 'high', reason: 'SQL destructive operation' },
  { pattern: /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, level: 'high', reason: 'SQL unconditional delete' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, level: 'high', reason: 'system power control' },
  { pattern: /\b(kill|killall|pkill)\b/i, level: 'medium', reason: 'process termination' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, level: 'high', reason: 'curl-pipe-shell execution' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, level: 'high', reason: 'wget-pipe-shell execution' },
  { pattern: /\beval\b/i, level: 'medium', reason: 'dynamic code evaluation' },
  { pattern: /\bexport\s+\w+\*=.*PATH\b/i, level: 'medium', reason: 'PATH environment modification' },
];

// Simpler inline patterns for broader detection
const INLINE_DANGER_PATTERN = /(?:(?:\brm\b)|(?:-rf)|(?:\bsudo\b)|(?::>))/i;

function isDangerPattern(s: string): boolean {
  return INLINE_DANGER_PATTERN.test(s);
}

/** Assess the risk level of a command. */
export function assessCommandRisk(command: string): RiskAssessment {
  for (const entry of DANGER_PATTERNS) {
    if (entry.pattern.test(command)) {
      return { level: entry.level, reason: entry.reason, requiresApproval: true };
    }
  }

  // Catch-all for simpler dangerous patterns
  if (isDangerPattern(command)) {
    return { level: 'high', reason: 'command matches dangerous pattern', requiresApproval: true };
  }

  return { level: 'low', reason: 'no dangerous patterns detected', requiresApproval: false };
}

/** Check if a tool + params combination requires approval. */
export function requiresApproval(tool: string, params?: Record<string, unknown>): RiskAssessment {
  if (tool === 'exec_cmd') {
    const cmd = typeof params?.command === 'string' ? params.command : '';
    if (!cmd) return { level: 'low', reason: 'empty command', requiresApproval: false };
    return assessCommandRisk(cmd);
  }

  if (tool === 'file_write') {
    // Flag writes to system-sensitive paths
    const targetPath = typeof params?.target_path === 'string' ? params.target_path : '';
    if (/^\/(etc|bin|sbin|boot|dev|proc|sys)\//.test(targetPath)) {
      return { level: 'high', reason: `writing to system path: ${targetPath}`, requiresApproval: true };
    }
    return { level: 'low', reason: 'standard file write', requiresApproval: false };
  }

  if (tool === 'dir_rm') {
    const path = typeof params?.path === 'string' ? params.path : '';
    if (/^\/(etc|bin|sbin|boot|dev|proc|sys)\//.test(path) || path === '/' || path === '/home') {
      return { level: 'high', reason: `removing system directory: ${path}`, requiresApproval: true };
    }
    return { level: 'medium', reason: 'directory removal', requiresApproval: true };
  }

  return { level: 'low', reason: 'low-risk tool', requiresApproval: false };
}
