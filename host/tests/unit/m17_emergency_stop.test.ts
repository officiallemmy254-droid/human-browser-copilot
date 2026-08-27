import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { TaskState } from "../../src/contracts/task.js";
import { TaskManager, createTaskContext, transitionTaskState, getTaskContext } from "../../src/task_state_machine.js";
import { TabLockManager, acquireTabLock } from "../../src/tab_lock_manager.js";
import { ApprovalBroker, requestApproval } from "../../src/approval_broker.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import {
  EmergencyStop,
  triggerEmergencyStop,
  registerTaskAbortController,
  registerTaskActiveCommand,
  registerTaskActionQueue,
  isEmergencyStopped
} from "../../src/emergency_stop.js";

describe("M17: Emergency Stop & Immediate Circuit Breaker", () => {
  beforeEach(() => {
    EmergencyStop.clear();
    TaskManager.clear();
    TabLockManager.clear();
    ApprovalBroker.clear();
  });

  it("should transition active task from EXECUTING to STOPPING and then STOPPED", () => {
    createTaskContext("task_stop_1");
    transitionTaskState("task_stop_1", TaskState.IDLE);
    transitionTaskState("task_stop_1", TaskState.EXECUTING);

    const result = triggerEmergencyStop("task_stop_1", "User pressed Emergency Stop button");

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(TaskState.STOPPED);
    expect(getTaskContext("task_stop_1")?.state).toBe(TaskState.STOPPED);
    expect(isEmergencyStopped("task_stop_1")).toBe(true);
  });

  it("should cancel all pending approvals for the stopped task with TASK_CANCELLED", async () => {
    createTaskContext("task_stop_approvals");
    transitionTaskState("task_stop_approvals", TaskState.IDLE);
    transitionTaskState("task_stop_approvals", TaskState.EXECUTING);

    const { promise: approvalPromise1 } = requestApproval({
      actionId: "act_1",
      taskId: "task_stop_approvals",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://bank.com",
      actionType: "click",
      reason: "Confirm Transfer"
    });

    const { promise: approvalPromise2 } = requestApproval({
      actionId: "act_2",
      taskId: "task_stop_approvals",
      tier: PermissionTier.EXTERNAL_SIDE_EFFECT,
      origin: "https://shop.com",
      actionType: "click",
      reason: "Place Order"
    });

    expect(ApprovalBroker.getPendingApprovals("task_stop_approvals")).toHaveLength(2);

    const result = triggerEmergencyStop("task_stop_approvals", "Kill Switch triggered");
    expect(result.cancelledApprovalsCount).toBe(2);

    // Approval promises must reject with TASK_CANCELLED
    await expect(approvalPromise1).rejects.toMatchObject({
      code: BrowserErrorCode.TASK_CANCELLED
    });
    await expect(approvalPromise2).rejects.toMatchObject({
      code: BrowserErrorCode.TASK_CANCELLED
    });

    expect(ApprovalBroker.getPendingApprovals("task_stop_approvals")).toHaveLength(0);
  });

  it("should release all tab locks held by the stopped task", () => {
    createTaskContext("task_stop_locks");
    transitionTaskState("task_stop_locks", TaskState.IDLE);

    acquireTabLock(101, "task_stop_locks");
    acquireTabLock(102, "task_stop_locks");
    acquireTabLock(201, "another_task"); // Lock held by another task

    expect(TabLockManager.isTabLocked(101)).toBe(true);
    expect(TabLockManager.isTabLocked(102)).toBe(true);
    expect(TabLockManager.isTabLocked(201)).toBe(true);

    const result = triggerEmergencyStop("task_stop_locks", "Security anomaly detected");
    expect(result.releasedLocksCount).toBe(2);

    // Tab locks for task_stop_locks must be released
    expect(TabLockManager.isTabLocked(101)).toBe(false);
    expect(TabLockManager.isTabLocked(102)).toBe(false);

    // Tab lock for another_task must remain untouched
    expect(TabLockManager.isTabLocked(201)).toBe(true);
  });

  it("should abort in-flight commands via registered AbortControllers", () => {
    const abortCtrl = new AbortController();
    let abortedReason: any = null;

    abortCtrl.signal.addEventListener("abort", () => {
      abortedReason = abortCtrl.signal.reason;
    });

    registerTaskAbortController("task_abort_test", abortCtrl);

    const result = triggerEmergencyStop("task_abort_test", "Aborting command");
    expect(result.abortedActiveCommandsCount).toBeGreaterThanOrEqual(1);
    expect(abortCtrl.signal.aborted).toBe(true);
    expect(abortedReason?.code).toBe(BrowserErrorCode.TASK_CANCELLED);
  });

  it("should invoke registered active command callbacks with TASK_CANCELLED error", () => {
    let receivedError: any = null;
    const cancelCallback = vi.fn((err) => {
      receivedError = err;
    });

    registerTaskActiveCommand("task_cmd_cancel", cancelCallback);

    triggerEmergencyStop("task_cmd_cancel", "Immediate stop");

    expect(cancelCallback).toHaveBeenCalledTimes(1);
    expect(receivedError?.code).toBe(BrowserErrorCode.TASK_CANCELLED);
  });

  it("should purge queued actions from registered queues", () => {
    let queuedItems = ["action_1", "action_2", "action_3"];
    const mockQueue = {
      purge: vi.fn(() => {
        const count = queuedItems.length;
        queuedItems = [];
        return count;
      })
    };

    registerTaskActionQueue("task_queue_test", mockQueue);

    const result = triggerEmergencyStop("task_queue_test", "Purging queue");
    expect(mockQueue.purge).toHaveBeenCalled();
    expect(result.purgedQueuedActionsCount).toBe(3);
    expect(queuedItems).toEqual([]);
  });

  it("should handle emergency stop on non-existent task gracefully", () => {
    const result = triggerEmergencyStop("non_existent_task", "Stop orphan");
    expect(result.success).toBe(true);
    expect(result.finalState).toBe(TaskState.STOPPED);
  });
});
