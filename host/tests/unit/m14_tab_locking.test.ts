import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  TabLockManager,
  acquireTabLock,
  releaseTabLock,
  releaseAllLocksForTask,
  renewTabLock
} from "../../src/tab_lock_manager.js";

describe("M14: Concurrency & Exclusive Tab Locking", () => {
  beforeEach(() => {
    TabLockManager.clear();
    TabLockManager.setMaxConcurrentTasks(5);
  });

  it("should acquire exclusive tab lock for a task", () => {
    const res = acquireTabLock(10, "task_A");
    expect(res.success).toBe(true);
    expect(TabLockManager.isTabLocked(10)).toBe(true);
    expect(TabLockManager.getLockedTabOwner(10)).toBe("task_A");
  });

  it("should reject concurrent control attempts on the same tab with TAB_LOCKED", () => {
    acquireTabLock(10, "task_A");

    // Task B attempts to acquire lock on Tab 10
    const resB = acquireTabLock(10, "task_B");
    expect(resB.success).toBe(false);
    expect(resB.error?.code).toBe(BrowserErrorCode.TAB_LOCKED);
    expect(resB.error?.message).toContain("Tab 10 is currently locked by task \"task_A\"");
  });

  it("should allow the same task to re-acquire or renew its own lock", () => {
    acquireTabLock(10, "task_A");
    const renewRes = renewTabLock(10, "task_A", 10000);
    expect(renewRes.success).toBe(true);

    const reacquire = acquireTabLock(10, "task_A");
    expect(reacquire.success).toBe(true);
  });

  it("should evict expired tab locks automatically after lease timeout", async () => {
    // Task A acquires with 40ms short lease
    acquireTabLock(20, "task_A", 40);

    // Immediate attempt by Task B fails
    expect(acquireTabLock(20, "task_B").success).toBe(false);

    // Wait for lease expiration
    await new Promise(r => setTimeout(r, 60));

    // Task B should now succeed
    const resB = acquireTabLock(20, "task_B");
    expect(resB.success).toBe(true);
    expect(TabLockManager.getLockedTabOwner(20)).toBe("task_B");
  });

  it("should release tab lock explicitly", () => {
    acquireTabLock(30, "task_A");
    expect(TabLockManager.isTabLocked(30)).toBe(true);

    releaseTabLock(30, "task_A");
    expect(TabLockManager.isTabLocked(30)).toBe(false);

    // Task B can now lock it
    expect(acquireTabLock(30, "task_B").success).toBe(true);
  });

  it("should enforce global maximum concurrent active tasks limit", () => {
    TabLockManager.setMaxConcurrentTasks(2);

    acquireTabLock(1, "task_1");
    acquireTabLock(2, "task_2");

    // Task 3 exceeds concurrency limit
    const res3 = acquireTabLock(3, "task_3");
    expect(res3.success).toBe(false);
    expect(res3.error?.code).toBe(BrowserErrorCode.INVALID_STATE);
    expect(res3.error?.message).toContain("Maximum concurrent active tasks limit reached (2)");
  });

  it("should release all locks for a task on cleanup", () => {
    acquireTabLock(101, "task_cleanup");
    acquireTabLock(102, "task_cleanup");
    acquireTabLock(201, "task_other");

    releaseAllLocksForTask("task_cleanup");

    expect(TabLockManager.isTabLocked(101)).toBe(false);
    expect(TabLockManager.isTabLocked(102)).toBe(false);
    expect(TabLockManager.isTabLocked(201)).toBe(true);
  });
});
