/**
 * Browser notification utilities for Crewden.
 *
 * Uses the Web Notifications API — no Service Worker required.
 * Notifications are suppressed when the page has focus to avoid interrupting
 * the user while they are actively watching the workspace.
 */

const PREFS_KEY = 'crewden_notify_prefs';

export type NotifyPrefs = {
  messages: boolean;
  tasks: boolean;
  agents: boolean;
};

const DEFAULT_PREFS: NotifyPrefs = {
  messages: true,
  tasks: true,
  agents: true,
};

export function loadPrefs(): NotifyPrefs {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (!stored) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: NotifyPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function canNotify(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function requestPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Fire a browser notification if:
 * - permission is granted
 * - the page does not have focus
 * - the relevant preference is enabled
 */
export function notifyBrowser(
  title: string,
  options: { body?: string; tag?: string },
  category: keyof NotifyPrefs,
): void {
  if (!canNotify()) return;
  if (document.hasFocus()) return;
  const prefs = loadPrefs();
  if (!prefs[category]) return;
  // eslint-disable-next-line no-new
  new Notification(title, {
    body: options.body,
    tag: options.tag,
    icon: '/favicon.ico',
  });
}
