import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { TaskState } from "../../src/contracts/task.js";
import { TaskManager, createTaskContext, transitionTaskState, getTaskContext } from "../../src/task_state_machine.js";
import { TabLockManager, acquireTabLock } from "../../src/tab_lock_manager.js";
import { ApprovalBroker, requestApproval } from "../../src/approval_broker.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import {
  DebuggerConflictManager,
  registerTabDebuggerSession,
  unregisterTabDebuggerSession,
  handleCDPDetachEvent,
  handleCDPDebuggerError,
  isDebuggerConflict
} from "../../src/debugger_conflict_manager.js";

describe("M18: CDP / Debugger Conflict & Clean Resource Recovery", () => {
  beforeEach(() => {
    DebuggerConflictManager.clear();
    TaskManager.clear();
    TabLockManager.clear();
    ApprovalBroker.clear();
  });

  describe("Conflict Pattern Recognition", () => {
    it("should detect various CDP conflict errors accurately", () => {
      expect(isDebuggerConflict("Cannot attach to existing target: tab is already debugged")).toBe(true);
      expect(isDebuggerConflict("Another debugger is already attached to this target")).toBe(true);
      expect(isDebuggerConflict("Session closed. Most likely the page has been closed or another debugger attached")).toBe(true);
      expect(isDebuggerConflict(new Error("Inspector detached by user"))).toBe(true);
      expect(isDebuggerConflict(new Error("replaced_with_devtools"))).toBe(true);

      // Non-conflicts
      expect(isDebuggerConflict(new Error("Element not found"))).toBe(false);
      expect(isDebuggerConflict(new Error("Timeout waiting for selector"))).toBe(false);
    });
  });

  describe("CDP Detach Event Handling (Inspector.detached)", () => {
    it("should release tab lock, cancel pending approvals, and produce DEBUGGER_CONFLICT on replaced_with_devtools", async () => {
      createTaskContext("task_cdp_1");
      transitionTaskState("task_cdp_1", TaskState.IDLE);
      transitionTaskState("task_cdp_1", TaskState.EXECUTING);

      // Lock tab 105 to task_cdp_1
      acquireTabLock(105, "task_cdp_1");
      registerTabDebuggerSession(105, "task_cdp_1");

      // Register an approval request
      const { promise: approvalPromise } = requestApproval({
        actionId: "act_cdp_appr",
        taskId: "task_cdp_1",
        tier: PermissionTier.HIGH_RISK,
        origin: "https://secure.example.com",
        actionType: "click",
        reason: "Sensitive Action"
      });

      expect(TabLockManager.isTabLocked(105)).toBe(true);
      expect(ApprovalBroker.getPendingApprovals("task_cdp_1")).toHaveLength(1);

      // User opens Chrome DevTools on Tab 105 -> triggers Inspector.detached
      const conflictResult = handleCDPDetachEvent(105, "replaced_with_devtools");

      expect(conflictResult.conflictDetected).toBe(true);
      expect(conflictResult.releasedLock).toBe(true);
      expect(conflictResult.error.code).toBe(BrowserErrorCode.DEBUGGER_CONFLICT);
      expect(conflictResult.error.message).toContain("Another debugger (e.g. Chrome DevTools) attached");
      expect(conflictResult.error.retryable).toBe(true);

      // Tab lock should be freed
      expect(TabLockManager.isTabLocked(105)).toBe(false);

      // Pending approval should be cancelled
      await expect(approvalPromise).rejects.toMatchObject({
        code: BrowserErrorCode.TASK_CANCELLED
      });

      // Task state should be ERROR
      expect(getTaskContext("task_cdp_1")?.state).toBe(TaskState.ERROR);
      expect(DebuggerConflictManager.isConflictActive(105)).toBe(true);
    });

    it("should notify event listeners on debugger conflict", () => {
      const listener = vi.fn();
      const unsubscribe = DebuggerConflictManager.subscribe(listener);

      registerTabDebuggerSession(202, "task_listener_test");
      handleCDPDetachEvent(202, "replaced_with_devtools");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].tabId).toBe(202);
      expect(listener.mock.calls[0][0].error.code).toBe(BrowserErrorCode.DEBUGGER_CONFLICT);

      unsubscribe();
    });

    it("should handle detach on unregistered tab cleanly without crashing", () => {
      const result = handleCDPDetachEvent(999, "target_closed");
      expect(result.conflictDetected).toBe(true);
      expect(result.tabId).toBe(999);
      expect(result.error.code).toBe(BrowserErrorCode.DEBUGGER_CONFLICT);
    });
  });

  describe("CDP Error Handling (handleCDPDebuggerError)", () => {
    it("should map CDP runtime conflict error and release resources", () => {
      createTaskContext("task_cdp_err");
      transitionTaskState("task_cdp_err", TaskState.IDLE);
      transitionTaskState("task_cdp_err", TaskState.EXECUTING);

      acquireTabLock(303, "task_cdp_err");
      registerTabDebuggerSession(303, "task_cdp_err");

      const err = handleCDPDebuggerError(
        new Error("Cannot attach to existing target: tab is already debugged"),
        303,
        "task_cdp_err"
      );

      expect(err.code).toBe(BrowserErrorCode.DEBUGGER_CONFLICT);
      expect(err.retryable).toBe(true);
      expect(TabLockManager.isTabLocked(303)).toBe(false);
      expect(getTaskContext("task_cdp_err")?.state).toBe(TaskState.ERROR);
    });
  });
});
