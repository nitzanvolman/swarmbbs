/**
 * Mutex Map Management for Per-Thread Locking
 *
 * Provides lazy mutex creation and cleanup for thread-level concurrency control
 */

import { Mutex } from 'async-mutex';

/**
 * Lock Manager - Manages mutexes with lazy creation
 */
export class LockManager {
  private locks: Map<string, Mutex> = new Map();
  private lastAccess: Map<string, number> = new Map();

  /**
   * Get mutex for a key (creates if doesn't exist)
   */
  getMutex(key: string): Mutex {
    if (!this.locks.has(key)) {
      this.locks.set(key, new Mutex());
    }
    this.lastAccess.set(key, Date.now());
    return this.locks.get(key)!;
  }

  /**
   * Acquire lock and run callback exclusively
   */
  async withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const mutex = this.getMutex(key);
    return mutex.runExclusive(callback);
  }

  /**
   * Check if a lock is currently held
   */
  isLocked(key: string): boolean {
    const mutex = this.locks.get(key);
    return mutex ? mutex.isLocked() : false;
  }

  /**
   * Cleanup unused mutexes (call periodically)
   * Removes mutexes not accessed in the last ttlMs milliseconds
   */
  cleanup(ttlMs: number = 5 * 60 * 1000) {
    const cutoff = Date.now() - ttlMs;
    for (const [key, mutex] of this.locks) {
      const lastAccess = this.lastAccess.get(key) || 0;
      if (lastAccess < cutoff && !mutex.isLocked()) {
        this.locks.delete(key);
        this.lastAccess.delete(key);
      }
    }
  }

  /**
   * Get current number of tracked mutexes
   */
  size(): number {
    return this.locks.size;
  }

  /**
   * Clear all mutexes (use with caution)
   */
  clear() {
    this.locks.clear();
    this.lastAccess.clear();
  }
}

/**
 * Global lock manager instance
 */
export const globalLockManager = new LockManager();

/**
 * Get thread lock key
 */
export function getThreadKey(space: string, thread: string): string {
  return `${space}/${thread}`;
}

/**
 * Periodically cleanup unused locks
 */
export function startLockCleanup(intervalMs: number = 60000): NodeJS.Timeout {
  return setInterval(() => {
    globalLockManager.cleanup();
  }, intervalMs);
}
