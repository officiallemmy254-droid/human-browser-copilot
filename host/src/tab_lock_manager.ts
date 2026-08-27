// Human Browser Runtime - Concurrency & Exclusive Tab Lock Controller (M14)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";

export interface TabLock {
  tabId: number;
  taskId: string;
  acquiredAt: number;
  leaseExpiresAt: number;
}

export interface TabLockResult {
  success: boolean;
  error?: BrowserError;
}

class TabLockController {
  private locks = new Map<number, TabLock>();
  private maxConcurrentTasks = 5;

  public clear(): void {
    this.locks.clear();
  }

  public setMaxConcurrentTasks(limit: number): void {
    this.maxConcurrentTasks = limit;
  }

  private purgeExpiredLocks(): void {
    const now = Date.now();
    for (const [tabId, lock] of this.locks.entries()) {
      if (now > lock.leaseExpiresAt) {
        this.locks.delete(tabId);
      }
    }
  }

  public getActiveTaskCount(): number {
    this.purgeExpiredLocks();
    const uniqueTasks = new Set<string>();
    for (const lock of this.locks.values()) {
      uniqueTasks.add(lock.taskId);
    }
    return uniqueTasks.size;
  }

  public isTabLocked(tabId: number): boolean {
    this.purgeExpiredLocks();
    return this.locks.has(tabId);
  }

  public getLockedTabOwner(tabId: number): string | null {
    this.purgeExpiredLocks();
    const lock = this.locks.get(tabId);
    return lock ? lock.taskId : null;
  }

  public acquireTabLock(tabId: number, taskId: string, leaseDurationMs: number = 30000): TabLockResult {
    this.purgeExpiredLocks();
    const now = Date.now();

    const existingLock = this.locks.get(tabId);

    // If locked by the same task, renew lease
    if (existingLock && existingLock.taskId === taskId) {
      existingLock.leaseExpiresAt = now + leaseDurationMs;
      return { success: true };
    }

    // If locked by another task and lease has not expired
    if (existingLock && existingLock.taskId !== taskId) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.TAB_LOCKED,
          `Tab ${tabId} is currently locked by task "${existingLock.taskId}" (Lease expires in ${Math.max(0, existingLock.leaseExpiresAt - now)}ms).`,
          { tabId, lockedByTaskId: existingLock.taskId, leaseExpiresAt: existingLock.leaseExpiresAt }
        )
      };
    }

    // Check concurrency limits across distinct tasks
    const activeTasks = new Set<string>();
    for (const lock of this.locks.values()) {
      activeTasks.add(lock.taskId);
    }

    if (!activeTasks.has(taskId) && activeTasks.size >= this.maxConcurrentTasks) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Maximum concurrent active tasks limit reached (${this.maxConcurrentTasks}). Wait for existing tasks to complete.`,
          { maxConcurrent: this.maxConcurrentTasks, activeTaskCount: activeTasks.size }
        )
      };
    }

    // Acquire lock
    this.locks.set(tabId, {
      tabId,
      taskId,
      acquiredAt: now,
      leaseExpiresAt: now + leaseDurationMs
    });

    return { success: true };
  }

  public renewTabLock(tabId: number, taskId: string, extendMs: number = 30000): TabLockResult {
    this.purgeExpiredLocks();
    const lock = this.locks.get(tabId);

    if (!lock || lock.taskId !== taskId) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.TAB_LOCKED,
          `Cannot renew lock: Tab ${tabId} is not held by task "${taskId}".`,
          { tabId, taskId }
        )
      };
    }

    lock.leaseExpiresAt = Date.now() + extendMs;
    return { success: true };
  }

  public releaseTabLock(tabId: number, taskId: string): boolean {
    const lock = this.locks.get(tabId);
    if (lock && lock.taskId === taskId) {
      this.locks.delete(tabId);
      return true;
    }
    return false;
  }

  public releaseAllLocksForTask(taskId: string): number {
    let count = 0;
    for (const [tabId, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(tabId);
        count++;
      }
    }
    return count;
  }
}

export const TabLockManager = new TabLockController();

export function acquireTabLock(tabId: number, taskId: string, leaseDurationMs?: number): TabLockResult {
  return TabLockManager.acquireTabLock(tabId, taskId, leaseDurationMs);
}

export function renewTabLock(tabId: number, taskId: string, extendMs?: number): TabLockResult {
  return TabLockManager.renewTabLock(tabId, taskId, extendMs);
}

export function releaseTabLock(tabId: number, taskId: string): boolean {
  return TabLockManager.releaseTabLock(tabId, taskId);
}

export function releaseAllLocksForTask(taskId: string): number {
  return TabLockManager.releaseAllLocksForTask(taskId);
}
