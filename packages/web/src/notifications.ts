/**
 * Browser notification utilities for Crewden.
 *
 * Uses the Web Notifications API — no Service Worker required.
 * Always fires regardless of page focus.
 * Also plays a sound and animates the tab title as a marquee.
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

// --- Sound ---

let audioCtx: AudioContext | undefined;

function getAudioCtx(): AudioContext | undefined {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  } catch {
    return undefined;
  }
}

function playNotificationSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    // Two short ascending tones: 880 Hz → 1320 Hz
    const now = ctx.currentTime;
    const notes = [880, 1320];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    // audio not available, silently skip
  }
}

// --- Tab title marquee ---

const ORIGINAL_TITLE = document.title;
let marqueeTimer: ReturnType<typeof setInterval> | undefined;
let marqueeText = '';
let marqueePos = 0;

function startMarquee(text: string): void {
  marqueeText = `🔔 ${text}    `;
  marqueePos = 0;

  if (marqueeTimer) clearInterval(marqueeTimer);

  let elapsed = 0;
  const DISPLAY_MS = 8000;
  const STEP_MS = 200;

  marqueeTimer = setInterval(() => {
    elapsed += STEP_MS;
    if (elapsed >= DISPLAY_MS) {
      clearInterval(marqueeTimer);
      marqueeTimer = undefined;
      document.title = ORIGINAL_TITLE;
      return;
    }
    const padded = marqueeText.repeat(2);
    const slice = padded.slice(marqueePos, marqueePos + 20);
    document.title = slice;
    marqueePos = (marqueePos + 1) % marqueeText.length;
  }, STEP_MS);
}

// Stop marquee when user focuses the tab
window.addEventListener('focus', () => {
  if (marqueeTimer) {
    clearInterval(marqueeTimer);
    marqueeTimer = undefined;
    document.title = ORIGINAL_TITLE;
  }
}, { passive: true });

// --- Main export ---

/**
 * Fire a browser notification (always, regardless of focus),
 * play a sound, and start a tab title marquee.
 */
export function notifyBrowser(
  title: string,
  options: { body?: string; tag?: string },
  category: keyof NotifyPrefs,
): void {
  const prefs = loadPrefs();
  if (!prefs[category]) return;

  // Tab title marquee + sound — always fire
  const marqueeLabel = options.body ? `${title}: ${options.body}` : title;
  startMarquee(marqueeLabel);
  playNotificationSound();

  // Browser notification — only if permission granted
  if (canNotify()) {
    // eslint-disable-next-line no-new
    new Notification(title, {
      body: options.body,
      tag: options.tag,
      icon: '/favicon.ico',
      silent: false,
    });
  }
}
