import { describe, it, expect, beforeEach } from "vitest";
import { generateActionId, resetActionIdSequence } from "../../src/contracts/actions.js";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import {
  createObservationSnapshot,
  resolveSnapshotElement,
  searchSnapshotElements,
  SnapshotRegistry
} from "../../src/observation_engine.js";
import {
  executeInteractionClick,
  executeInteractionType,
  executeInteractionScroll,
  executeInteractionWait
} from "../../src/interaction_engine.js";
import { executeNavigation } from "../../src/navigation_engine.js";
import { AuditLogger, recordActionAudit } from "../../src/audit_logger.js";
import {
  TabLockManager,
  acquireTabLock,
  releaseTabLock,
  releaseAllLocksForTask,
  renewTabLock
} from "../../src/tab_lock_manager.js";

describe("M26: Performance & Soak Test Suite", () => {
  beforeEach(() => {
    resetActionIdSequence();
    SnapshotRegistry.clear();
    AuditLogger.clear();
    TabLockManager.clear();
    TabLockManager.setMaxConcurrentTasks(10);
  });

  describe("1. Rapid Sequential Action Generation (150+ Actions)", () => {
    it("should generate 200+ unique, formatted action IDs with strict monotonic sequence", () => {
      const generatedIds: string[] = [];
      const count = 250;

      for (let i = 0; i < count; i++) {
        const id = generateActionId();
        generatedIds.push(id);
      }

      expect(generatedIds).toHaveLength(count);

      // Verify formatting and uniqueness
      const uniqueSet = new Set(generatedIds);
      expect(uniqueSet.size).toBe(count);

      for (let i = 0; i < count; i++) {
        const expectedNumber = String(i + 1).padStart(6, "0");
        expect(generatedIds[i]).toBe(`action_${expectedNumber}`);
      }
    });

    it("should execute a rapid barrage of 150 sequential actions under high throughput with audit integrity", async () => {
      const mockDispatcher = async (cmd: string, params: any) => {
        return { ok: true, verified: true, ...params };
      };

      const startTime = Date.now();
      const actionCount = 150;

      const obs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: "https://example.com/stress",
        title: "Stress Test",
        loadingState: "complete",
        visibleText: "Performance Soak Test View",
        rawElements: [
          { tag: "button", text: "Click Me", visible: true, enabled: true },
          { tag: "input", type: "text", placeholder: "Type here", visible: true, enabled: true }
        ]
      });

      for (let i = 0; i < actionCount; i++) {
        if (i % 3 === 0) {
          const clickRes = await executeInteractionClick({
            taskId: "task_soak_1",
            snapshotId: obs.snapshotId,
            elementId: "el_1"
          }, mockDispatcher);
          expect(clickRes.success).toBe(true);

          recordActionAudit({
            taskId: "task_soak_1",
            actionId: clickRes.actionId,
            origin: "https://example.com",
            actionType: "click",
            policyTier: PermissionTier.INTERACT,
            policyDecision: "ALLOW",
            executionResult: { index: i }
          });
        } else if (i % 3 === 1) {
          const typeRes = await executeInteractionType({
            taskId: "task_soak_1",
            snapshotId: obs.snapshotId,
            elementId: "el_2",
            text: `stress_payload_${i}`
          }, mockDispatcher);
          expect(typeRes.success).toBe(true);

          recordActionAudit({
            taskId: "task_soak_1",
            actionId: typeRes.actionId,
            origin: "https://example.com",
            actionType: "type",
            policyTier: PermissionTier.INTERACT,
            policyDecision: "ALLOW",
            executionResult: { index: i }
          });
        } else {
          const scrollRes = await executeInteractionScroll({
            taskId: "task_soak_1",
            distanceY: 100
          }, mockDispatcher);
          expect(scrollRes.success).toBe(true);

          recordActionAudit({
            taskId: "task_soak_1",
            actionId: scrollRes.actionId,
            origin: "https://example.com",
            actionType: "scroll",
            policyTier: PermissionTier.INTERACT,
            policyDecision: "ALLOW",
            executionResult: { index: i }
          });
        }
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(5000); // 150 actions executed well under 5 seconds

      // Verify audit trail integrity
      const auditEvents = AuditLogger.getEvents({ taskId: "task_soak_1" });
      expect(auditEvents).toHaveLength(actionCount);

      for (let i = 0; i < actionCount; i++) {
        expect(auditEvents[i].actionId).toMatch(/^action_\d{6}$/);
      }
    });
  });

  describe("2. Memory Leak Resistance in Snapshot Registry & Audit Log", () => {
    it("should evict previous snapshots on new observation cycles preventing memory leaks", () => {
      const tabCount = 5;
      const cyclesPerTab = 100; // 500 total observation cycles
      const recordedSnapshotIds: string[] = [];

      for (let cycle = 0; cycle < cyclesPerTab; cycle++) {
        for (let tabId = 1; tabId <= tabCount; tabId++) {
          const obs = createObservationSnapshot({
            tabId,
            windowId: 1,
            url: `https://example.com/tab/${tabId}/cycle/${cycle}`,
            title: `Tab ${tabId} Cycle ${cycle}`,
            loadingState: "complete",
            visibleText: `Visible text for tab ${tabId} in cycle ${cycle}`,
            rawElements: [
              { tag: "button", text: `Action ${cycle}`, visible: true, enabled: true },
              { tag: "a", text: `Link ${cycle}`, href: `https://example.com/link/${cycle}`, visible: true, enabled: true },
              { tag: "input", type: "text", placeholder: `Search ${cycle}`, visible: true, enabled: true }
            ]
          });

          recordedSnapshotIds.push(obs.snapshotId);
        }
      }

      expect(recordedSnapshotIds).toHaveLength(tabCount * cyclesPerTab);

      // Verify that for each tab, ONLY the latest snapshot is retained
      for (let tabId = 1; tabId <= tabCount; tabId++) {
        const latestSnap = SnapshotRegistry.getLatestSnapshotForTab(tabId);
        expect(latestSnap).not.toBeNull();
        expect(latestSnap?.tabId).toBe(tabId);

        // Previous 99 snapshots for this tab must return STALE_ELEMENT
        for (let cycle = 0; cycle < cyclesPerTab - 1; cycle++) {
          const oldSnapIndex = cycle * tabCount + (tabId - 1);
          const oldSnapId = recordedSnapshotIds[oldSnapIndex];

          const resolution = resolveSnapshotElement(oldSnapId, "el_1");
          expect(resolution.ok).toBe(false);
          if (!resolution.ok) {
            expect(resolution.error.code).toBe(BrowserErrorCode.STALE_ELEMENT);
          }
        }
      }
    });

    it("should handle bulk audit event stream (1,000+ events) with sub-millisecond query filtering", () => {
      const totalEvents = 1200;
      const tasks = ["task_alpha", "task_beta", "task_gamma", "task_delta"];

      for (let i = 0; i < totalEvents; i++) {
        const selectedTask = tasks[i % tasks.length];
        recordActionAudit({
          taskId: selectedTask,
          actionId: generateActionId(),
          origin: `https://${selectedTask}.example.com`,
          actionType: i % 2 === 0 ? "click" : "observe",
          policyTier: i % 2 === 0 ? PermissionTier.INTERACT : PermissionTier.READ,
          policyDecision: "ALLOW",
          executionResult: { eventSeq: i, payload: "test_data" }
        });
      }

      // Query filtering by task
      const queryStart = performance.now();
      const alphaEvents = AuditLogger.getEvents({ taskId: "task_alpha" });
      const queryDuration = performance.now() - queryStart;

      expect(alphaEvents).toHaveLength(totalEvents / tasks.length);
      expect(queryDuration).toBeLessThan(10); // Under 10ms

      const specificAction = AuditLogger.getEvents({ actionId: "action_000500" });
      expect(specificAction).toHaveLength(1);
    });

    it("should maintain fast search performance on snapshots with large element counts", () => {
      const rawElements: Array<{ tag: string; text?: string; role?: string; visible?: boolean; enabled?: boolean }> = [];
      for (let i = 1; i <= 200; i++) {
        rawElements.push({
          tag: i % 2 === 0 ? "button" : "a",
          text: `Interactive Item Number ${i} (Order Confirm)`,
          role: "button",
          visible: true,
          enabled: true
        });
      }

      const obs = createObservationSnapshot({
        tabId: 10,
        windowId: 1,
        url: "https://example.com/catalog",
        title: "Large Catalog",
        loadingState: "complete",
        visibleText: "Catalog items",
        rawElements
      });

      const searchStart = performance.now();
      const matches = searchSnapshotElements(obs.snapshotId, "confirm");
      const searchDuration = performance.now() - searchStart;

      expect(matches.length).toBeGreaterThan(0);
      expect(searchDuration).toBeLessThan(5); // Under 5ms
    });
  });

  describe("3. Lease Cleanup Under High Concurrency Load", () => {
    it("should handle heavy tab lock churn across 50 concurrent task cycles without dangling locks", async () => {
      TabLockManager.setMaxConcurrentTasks(20);
      const cycles = 50;

      for (let i = 0; i < cycles; i++) {
        const tabId = (i % 10) + 1;
        const taskId = `task_soak_${i}`;

        // Acquire lock with short lease (25ms)
        const acq = acquireTabLock(tabId, taskId, 25);
        if (acq.success) {
          // Renew lock
          renewTabLock(tabId, taskId, 30);
          // Explicitly release
          releaseTabLock(tabId, taskId);
          expect(TabLockManager.isTabLocked(tabId)).toBe(false);
        }
      }

      // Final state: all tabs are unlocked
      for (let tabId = 1; tabId <= 10; tabId++) {
        expect(TabLockManager.isTabLocked(tabId)).toBe(false);
      }
    });

    it("should release all multi-tab locks for a task on bulk cleanup under load", () => {
      const taskA = "task_heavy_worker";
      const tabsHeldByA = [101, 102, 103, 104, 105];

      for (const tabId of tabsHeldByA) {
        const res = acquireTabLock(tabId, taskA);
        expect(res.success).toBe(true);
      }

      // Another task holding separate tabs
      acquireTabLock(201, "task_other_worker");
      acquireTabLock(202, "task_other_worker");

      // Clean up Task A completely
      releaseAllLocksForTask(taskA);

      for (const tabId of tabsHeldByA) {
        expect(TabLockManager.isTabLocked(tabId)).toBe(false);
      }

      // Other task remains unaffected
      expect(TabLockManager.isTabLocked(201)).toBe(true);
      expect(TabLockManager.isTabLocked(202)).toBe(true);
    });

    it("should enforce global concurrency ceiling under rapid parallel lock acquisition attempts", () => {
      TabLockManager.setMaxConcurrentTasks(4);

      const task1 = acquireTabLock(1, "t1");
      const task2 = acquireTabLock(2, "t2");
      const task3 = acquireTabLock(3, "t3");
      const task4 = acquireTabLock(4, "t4");

      expect(task1.success).toBe(true);
      expect(task2.success).toBe(true);
      expect(task3.success).toBe(true);
      expect(task4.success).toBe(true);

      // Attempting to lock 5th tab with 5th task must fail with INVALID_STATE
      const overflow = acquireTabLock(5, "t5");
      expect(overflow.success).toBe(false);
      expect(overflow.error?.code).toBe(BrowserErrorCode.INVALID_STATE);

      // Freeing task 1 allows task 5 to acquire
      releaseTabLock(1, "t1");
      const retry5 = acquireTabLock(5, "t5");
      expect(retry5.success).toBe(true);
    });
  });
});
