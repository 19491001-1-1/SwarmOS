type LockEntry = { owner: string; since: string };
type ReleasedEntry = { owner: string; since: string; releasedAt: string };
type LockChangeCallback = (path: string, state: 'locked' | 'released', owner: string) => void;

class LockManager {
  private locks = new Map<string, LockEntry>();
  private released = new Map<string, ReleasedEntry>();
  private listeners = new Set<LockChangeCallback>();

  onChange(cb: LockChangeCallback): void {
    this.listeners.add(cb);
  }

  offChange(cb: LockChangeCallback): void {
    this.listeners.delete(cb);
  }

  acquire(path: string, owner: string): { granted: boolean; currentOwner?: string } {
    // clean up any stale released entry
    if (this.released.has(path)) {
      this.released.delete(path);
    }
    const existing = this.locks.get(path);
    if (!existing) {
      this.locks.set(path, { owner, since: new Date().toISOString() });
      this.emitChange(path, 'locked', owner);
      return { granted: true };
    }
    return { granted: false, currentOwner: existing.owner };
  }

  release(path: string, owner: string): boolean {
    const existing = this.locks.get(path);
    if (!existing) return true;
    if (existing.owner !== owner) return false;
    // Move to released records instead of deleting
    const now = new Date().toISOString();
    this.released.set(path, { ...existing, releasedAt: now });
    this.locks.delete(path);
    this.emitChange(path, 'released', owner);
    return true;
  }

  private emitChange(path: string, state: 'locked' | 'released', owner: string): void {
    for (const listener of this.listeners) {
      try { listener(path, state, owner); } catch (_) {}
    }
  }

  status(path: string) {
    const active = this.locks.get(path);
    if (active) {
      return { state: 'locked' as const, owner: active.owner, since: active.since };
    }
    const releasedEntry = this.released.get(path);
    if (releasedEntry) {
      return { state: 'released' as const, owner: releasedEntry.owner, since: releasedEntry.since };
    }
    return { state: 'unlocked' as const };
  }

  isLocked(path: string): boolean {
    return this.locks.has(path);
  }

  isReleased(path: string): boolean {
    return this.released.has(path);
  }

  /**
   * Remove released entries older than the given age in milliseconds.
   * Call periodically to prevent memory leaks.
   */
  cleanExpiredReleased(maxAgeMs: number = 60000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [path, entry] of this.released) {
      if (new Date(entry.releasedAt).getTime() <= cutoff) {
        this.released.delete(path);
      }
    }
  }

  /** Clear all state — for testing only. */
  reset(): void {
    this.locks.clear();
    this.released.clear();
  }
}

export const lockManager = new LockManager();
