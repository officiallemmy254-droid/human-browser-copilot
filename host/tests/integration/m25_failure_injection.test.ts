import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode, BrowserError } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import { TaskState } from "../../src/contracts/task.js";
import {
  mapErrorToCanonical,
  createCanonicalError,
  isRetryableErrorCode
} from "../../src/error_mapper.js";
import {
  TaskManager,
  createTaskContext,
  transitionTaskState,
  getTaskContext
} from "../../src/task_state_machine.js";
import {
  createObservationSnapshot,
  resolveSnapshotElement,
  SnapshotRegistry
} from "../../src/observation_engine.js";
import {
  executeInteractionClick,
  executeInteractionType,
  executeInteractionClear
} from "../../src/interaction_engine.js";
import { executeNavigation, executeWait } from "../../src/navigation_engine.js";
import {
  ApprovalBroker,
  requestApproval,
  resolveApprovalRequest,
  cancelPendingApprovalsForTask
} from "../../src/approval_broker.js";
import {
  TabLockManager,
  acquireTabLock,
  releaseTabLock,
  releaseAllLocksForTask,
  renewTabLock
} from "../../src/tab_lock_manager.js";
import {
  verifyTypeAction,
  verifyCheckedState,
  verifyElementPresence,
  verifyUrlChanged
} from "../../src/action_verifier.js";

describe("M25: Failure Injection Suite", () => {
  beforeEach(() => {
    SnapshotRegistry.clear();
    ApprovalBroker.clear();
    TabLockManager.clear();
    TabLockManager.setMaxConcurrentTasks(5);
    TaskManager.clear();
  });

  describe("1. CDP Disconnection & Debugger Conflict Simulation", () => {
    it("should map unexpected CDP disconnection and debugger conflict events to canonical error codes", () => {
      // Raw Chrome DevTools Protocol / WebSocket disconnection errors
      const cdpErrors = [
        {
          raw: new Error("Target.detachedFromTarget: Session closed. Most likely the page has been closed"),
          expectedCode: BrowserErrorCode.TAB_NOT_FOUND,
          expectedRetryable: false
        },
        {
          raw: new Error("Cannot attach to existing target: tab is already debugged by another debugger"),
          expectedCode: BrowserErrorCode.DEBUGGER_CONFLICT,
          expectedRetryable: true
        },
        {
          raw: new Error("Detached by user: DevTools window was opened on this tab"),
          expectedCode: BrowserErrorCode.DEBUGGER_CONFLICT,
          expectedRetryable: true
        },
        {
          raw: new Error("No tab with id: 404 found in browser context"),
          expectedCode: BrowserErrorCode.TAB_NOT_FOUND,
          expectedRetryable: false
        }
      ];

      for (const item of cdpErrors) {
        const canonical = mapErrorToCanonical(item.raw);
        expect(canonical.code).toBe(item.expectedCode);
        expect(canonical.retryable).toBe(item.expectedRetryable);
      }
    });

    it("should handle sudden CDP connection drop during active interaction and transition task to ERROR", async () => {
      const task = createTaskContext("task_cdp_drop");
      transitionTaskState("task_cdp_drop", TaskState.RUNNING);
      transitionTaskState("task_cdp_drop", TaskState.INTERACTING);

      const obs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: "https://example.com/checkout",
        title: "Checkout",
        loadingState: "complete",
        visibleText: "Submit Order",
        rawElements: [{ tag: "button", text: "Submit Order", visible: true, enabled: true }]
      });

      // Dispatcher throws sudden CDP disconnection
      const failingDispatcher = async () => {
        throw new Error("Target.detachedFromTarget: WebSocket connection dropped unexpectedly");
      };

      const result = await executeInteractionClick({
        taskId: "task_cdp_drop",
        snapshotId: obs.snapshotId,
        elementId: "el_1"
      }, failingDispatcher);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(BrowserErrorCode.TAB_NOT_FOUND);

      // Transition task into ERROR state upon fatal communication loss
      const transitionRes = transitionTaskState("task_cdp_drop", TaskState.ERROR, "CDP target detached");
      expect(transitionRes.success).toBe(true);
      expect(getTaskContext("task_cdp_drop")?.state).toBe(TaskState.ERROR);
    });
  });

  describe("2. Unexpected Navigation & Wait Timeout Simulation", () => {
    it("should return typed TIMEOUT error when navigation request exceeds deadline", async () => {
      const failingDispatcher = async () => {
        throw new Error("Navigation timeout of 30000ms exceeded while waiting for domcontentloaded");
      };

      const result = await executeNavigation({
        taskId: "task_nav_timeout",
        url: "https://slow-service.example.com",
        tabId: 10
      }, failingDispatcher);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(BrowserErrorCode.TIMEOUT);
      expect(result.error?.message).toContain("Navigation timeout");
    });

    it("should invalidate old snapshot registry entries when navigation fails", async () => {
      const obs = createObservationSnapshot({
        tabId: 12,
        windowId: 1,
        url: "https://example.com/step1",
        title: "Step 1",
        loadingState: "complete",
        visibleText: "Step 1 Content",
        rawElements: [{ tag: "button", text: "Next", visible: true, enabled: true }]
      });

      expect(SnapshotRegistry.getSnapshot(obs.snapshotId)).not.toBeNull();

      // Navigation attempt to step 2 executes and invalidates step 1
      const mockDispatcher = async (cmd: string, params: any) => ({ ok: true, navigated: true, url: params.url, tabId: 12 });

      await executeNavigation({
        taskId: "task_nav_invalidate",
        url: "https://example.com/step2",
        tabId: 12
      }, mockDispatcher);

      // Previous snapshot must be invalidated
      expect(SnapshotRegistry.getSnapshot(obs.snapshotId)).toBeNull();
    });

    it("should return typed TIMEOUT error with retryable=true when wait condition expires", async () => {
      const failingWaitDispatcher = async () => {
        throw new Error("Timeout waiting for selector: \"#confirmation-modal\" after 5000ms");
      };

      const result = await executeWait({
        taskId: "task_wait_timeout",
        condition: "element_appears",
        target: "#confirmation-modal",
        timeoutMs: 5000
      }, failingWaitDispatcher);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(BrowserErrorCode.TIMEOUT);
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe("3. Stale Element Mutations & Verification Failures", () => {
    it("should reject interaction with STALE_ELEMENT when DOM has mutated or snapshot is superseded", async () => {
      // 1. Initial snapshot
      const snap1 = createObservationSnapshot({
        tabId: 5,
        windowId: 1,
        url: "https://example.com/page",
        title: "Page",
        loadingState: "complete",
        visibleText: "Initial View",
        rawElements: [
          { tag: "button", text: "Delete Item", visible: true, enabled: true },
          { tag: "input", type: "text", placeholder: "Filter", visible: true, enabled: true }
        ]
      });

      // 2. DOM mutation occurs, creating a fresh snapshot
      const snap2 = createObservationSnapshot({
        tabId: 5,
        windowId: 1,
        url: "https://example.com/page",
        title: "Page",
        loadingState: "complete",
        visibleText: "Mutated View",
        rawElements: [
          { tag: "button", text: "New Action", visible: true, enabled: true }
        ]
      });

      const mockDispatcher = async () => ({ ok: true });

      // Attempting to click el_1 from snap1 (superseded) must fail with STALE_ELEMENT
      const clickRes = await executeInteractionClick({
        taskId: "task_stale_test",
        snapshotId: snap1.snapshotId,
        elementId: "el_1"
      }, mockDispatcher);

      expect(clickRes.success).toBe(false);
      expect(clickRes.error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);
      expect(clickRes.error?.message).toContain("expired, replaced, or invalid");

      // Attempting to type into non-existent el_99 in snap2 must fail with STALE_ELEMENT
      const typeRes = await executeInteractionType({
        taskId: "task_stale_test",
        snapshotId: snap2.snapshotId,
        elementId: "el_99",
        text: "hello"
      }, mockDispatcher);

      expect(typeRes.success).toBe(false);
      expect(typeRes.error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);
      expect(typeRes.error?.message).toContain("stale or not present");
    });

    it("should return VERIFICATION_FAILED when post-action state check detects element was not updated", async () => {
      // Simulate input field where DOM evaluation reveals the text was not populated
      const mockEvaluator = async (script: string) => {
        return "unexpected_old_value"; // Did not match expected text
      };

      const verification = await verifyTypeAction("#username", "target_username", mockEvaluator);
      expect(verification.verified).toBe(false);
      expect(verification.status).toBe("FAILED");
      expect(verification.error?.code).toBe(BrowserErrorCode.VERIFICATION_FAILED);
      expect(verification.error?.message).toContain("Verification failed for type action on \"#username\"");
    });

    it("should return VERIFICATION_FAILED when element presence check fails", async () => {
      const mockEvaluator = async () => false; // Element is missing from DOM

      const verification = await verifyElementPresence("#success-banner", true, mockEvaluator);
      expect(verification.verified).toBe(false);
      expect(verification.status).toBe("FAILED");
      expect(verification.error?.code).toBe(BrowserErrorCode.VERIFICATION_FAILED);
      expect(verification.error?.message).toContain("Expected present=true but found present=false");
    });
  });

  describe("4. Approval Timeout & Human Cancellation Simulation", () => {
    it("should reject waiting promise with APPROVAL_TIMEOUT when deadline expires", async () => {
      const { request, promise } = requestApproval({
        actionId: "action_timeout_test",
        taskId: "task_appr_timeout",
        tier: PermissionTier.HIGH_RISK,
        origin: "https://bank.com",
        actionType: "click",
        reason: "Confirm financial transfer",
        timeoutMs: 40 // 40ms deadline
      });

      expect(request.state).toBe("PENDING");

      await expect(promise).rejects.toMatchObject({
        code: BrowserErrorCode.APPROVAL_TIMEOUT
      });

      // Verify request state transitioned to EXPIRED
      const updated = ApprovalBroker.getApproval(request.requestId);
      expect(updated?.state).toBe("EXPIRED");
    });

    it("should prevent double-resolution after approval expiration", async () => {
      const { request, promise } = requestApproval({
        actionId: "action_double_res",
        taskId: "task_appr_exp",
        tier: PermissionTier.HIGH_RISK,
        origin: "https://bank.com",
        actionType: "click",
        reason: "Confirm transfer",
        timeoutMs: 30
      });

      await expect(promise).rejects.toThrow();

      // Attempting to approve after timeout expiration must fail
      const lateResolve = resolveApprovalRequest(request.requestId, true, "late-user");
      expect(lateResolve.success).toBe(false);
      expect(lateResolve.error).toContain("not found or already resolved");
    });

    it("should cancel all pending approvals when task is aborted or terminated", async () => {
      const { request: req1, promise: p1 } = requestApproval({
        actionId: "action_cancel_1",
        taskId: "task_to_cancel",
        tier: PermissionTier.EXTERNAL_SIDE_EFFECT,
        origin: "https://example.com",
        actionType: "click",
        reason: "Side effect 1"
      });

      const { request: req2, promise: p2 } = requestApproval({
        actionId: "action_cancel_2",
        taskId: "task_to_cancel",
        tier: PermissionTier.HIGH_RISK,
        origin: "https://example.com",
        actionType: "click",
        reason: "Side effect 2"
      });

      // Task is cancelled by emergency stop or user
      cancelPendingApprovalsForTask("task_to_cancel");

      expect(ApprovalBroker.getApproval(req1.requestId)?.state).toBe("CANCELLED");
      expect(ApprovalBroker.getApproval(req2.requestId)?.state).toBe("CANCELLED");

      await expect(p1).rejects.toMatchObject({ code: BrowserErrorCode.TASK_CANCELLED });
      await expect(p2).rejects.toMatchObject({ code: BrowserErrorCode.TASK_CANCELLED });
    });
  });

  describe("5. Tab Locking Conflicts & Concurrency Ceiling Simulation", () => {
    it("should reject concurrent access to a locked tab with TAB_LOCKED", () => {
      const lockResA = acquireTabLock(42, "task_owner_A");
      expect(lockResA.success).toBe(true);
      expect(TabLockManager.isTabLocked(42)).toBe(true);

      // Task B attempts to acquire Tab 42
      const lockResB = acquireTabLock(42, "task_interferer_B");
      expect(lockResB.success).toBe(false);
      expect(lockResB.error?.code).toBe(BrowserErrorCode.TAB_LOCKED);
      expect(lockResB.error?.message).toContain("Tab 42 is currently locked by task \"task_owner_A\"");
    });

    it("should reject new tab acquisitions when global concurrency limit is reached", () => {
      TabLockManager.setMaxConcurrentTasks(3);

      expect(acquireTabLock(1, "task_1").success).toBe(true);
      expect(acquireTabLock(2, "task_2").success).toBe(true);
      expect(acquireTabLock(3, "task_3").success).toBe(true);

      // 4th concurrent task exceeds cap
      const overflow = acquireTabLock(4, "task_4");
      expect(overflow.success).toBe(false);
      expect(overflow.error?.code).toBe(BrowserErrorCode.INVALID_STATE);
      expect(overflow.error?.message).toContain("Maximum concurrent active tasks limit reached (3)");
    });

    it("should automatically evict expired lock leases allowing waiting tasks to acquire control", async () => {
      // Task A acquires with very short lease (30ms)
      acquireTabLock(99, "task_short_lease", 30);
      expect(TabLockManager.isTabLocked(99)).toBe(true);

      // Task B fails immediately
      expect(acquireTabLock(99, "task_waiting").success).toBe(false);

      // Wait for lease auto-expiration
      await new Promise(resolve => setTimeout(resolve, 50));

      // Task B should now succeed
      const lockB = acquireTabLock(99, "task_waiting");
      expect(lockB.success).toBe(true);
      expect(TabLockManager.getLockedTabOwner(99)).toBe("task_waiting");
    });

    it("should allow owner task to renew or re-acquire its own lock", () => {
      acquireTabLock(55, "task_owner");
      expect(renewTabLock(55, "task_owner", 15000).success).toBe(true);
      expect(acquireTabLock(55, "task_owner").success).toBe(true);
    });

    it("should release all locks cleanly when task cleanup executes", () => {
      acquireTabLock(10, "task_multi");
      acquireTabLock(11, "task_multi");
      acquireTabLock(12, "task_multi");
      acquireTabLock(20, "task_other");

      releaseAllLocksForTask("task_multi");

      expect(TabLockManager.isTabLocked(10)).toBe(false);
      expect(TabLockManager.isTabLocked(11)).toBe(false);
      expect(TabLockManager.isTabLocked(12)).toBe(false);
      expect(TabLockManager.isTabLocked(20)).toBe(true);
    });
  });
});
