/**
 * Daemon-side risk policy — last-line defense.
 *
 * These patterns are the final safety check before executing commands locally.
 * The server runs its own risk assessment first; this module is the daemon-level
 * backstop to catch anything the server may have missed.
 */

export type RiskResult = {
  dangerous: boolean;
  level: 'low' | 'medium' | 'high';
  reason: string;
};

const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:\brm\b.*-(?:r|f|rf|fr)\b|rm\s+-[^-]*[rf])/i, reason: 'recursive file removal' },
  { pattern: /(?::>|2>&1.*>)/i, reason: 'stdout redirection may overwrite files' },
  { pattern: /\bsudo\b/i, reason: 'privilege escalation (sudo)' },
  { pattern: /\bchmod\s+777\b/i, reason: 'world-writable permission change' },
  { pattern: /\bchown\b/i, reason: 'file ownership change' },
  { pattern: /\bmkfs\b/i, reason: 'filesystem formatting' },
  { pattern: /\b(mv|cp)\b.*\/(etc|bin|sbin|boot|dev)\//i, reason: 'modifying system directories' },
  { pattern: /\b(git\s+push\s+--force|git\s+push\s+-f)\b/i, reason: 'force push to remote' },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/i, reason: 'docker resource removal' },
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: 'SQL destructive operation' },
  { pattern: /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, reason: 'SQL unconditional delete' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'system power control' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, reason: 'curl-pipe-shell execution' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, reason: 'wget-pipe-shell execution' },
  { pattern: /\beval\b/i, reason: 'dynamic code evaluation' },
  { pattern: /\b(kill|killall|pkill)\b/i, reason: 'process termination' },
  { pattern: /\bnpm\s+(unpublish|deprecate)\b/i, reason: 'npm package registry mutation' },
];

/** Simple broad-match pattern for fast pre-check */
const BROAD_DANGER = /(?:(?:\brm\b)|(?:-rf)|(?:\bsudo\b)|(?::>))/i;

/** Assess risk for an exec_cmd command. */
export function assessExecCommand(cmd: string): RiskResult {
  for (const entry of HIGH_RISK_PATTERNS) {
    if (entry.pattern.test(cmd)) {
      return { dangerous: true, level: 'high', reason: entry.reason };
    }
  }
  if (BROAD_DANGER.test(cmd)) {
    return { dangerous: true, level: 'high', reason: 'command matches dangerous pattern' };
  }
  return { dangerous: false, level: 'low', reason: 'safe' };
}

/** Assess risk for a file_write action targeting a system path. */
export function assessFileWritePath(targetPath: string): RiskResult {
  if (/^\/(etc|bin|sbin|boot|dev|proc|sys)\//.test(targetPath)) {
    return { dangerous: true, level: 'high', reason: `writing to system path: ${targetPath}` };
  }
  return { dangerous: false, level: 'low', reason: 'safe' };
}

/** Assess risk for a dir_rm action. */
export function assessDirRmPath(path: string): RiskResult {
  if (path === '/' || path === '/home' || /^\/(etc|bin|sbin|boot|dev|proc|sys)\//.test(path)) {
    return { dangerous: true, level: 'high', reason: `removing system directory: ${path}` };
  }
  return { dangerous: true, level: 'medium', reason: 'directory removal requires approval' };
}
