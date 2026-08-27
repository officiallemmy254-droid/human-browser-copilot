import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import { PolicyEngine } from "../../src/policy_engine.js";
import { SnapshotRegistry, createObservationSnapshot } from "../../src/observation_engine.js";
import { AuditLogger } from "../../src/audit_logger.js";
import { EventStreamer } from "../../src/event_streamer.js";
import {
  DryRunSimulator,
  simulateBrowserAction,
  simulateBrowserBatch
} from "../../src/dry_run_simulator.js";

describe("M23: Dry Run Execution Mode & Policy Simulation", () => {
  beforeEach(() => {
    PolicyEngine.resetToDefaults();
    SnapshotRegistry.clear();
    AuditLogger.clear();
    EventStreamer.clear();
  });

  describe("Single Action Simulation", () => {
    it("should simulate click action with resolved element coordinates without DOM mutation", async () => {
      const observation = createObservationSnapshot({
        tabId: 10,
        windowId: 1,
        url: "https://example.com/login",
        title: "Login",
        loadingState: "complete",
        visibleText: "Please log in",
        rawElements: [
          {
            tag: "button",
            text: "Sign In",
            visible: true,
            enabled: true,
            boundingBox: { x: 100, y: 200, width: 80, height: 40 }
          }
        ]
      });

      const result = await simulateBrowserAction(
        "click",
        {
          elementId: "el_1",
          snapshotId: observation.snapshotId
        },
        {
          taskId: "task_dry_1",
          origin: "https://example.com"
        }
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.result?.clickedCoordinates).toEqual({ x: 140, y: 220 });
      expect(result.policyDecision).toBe("ALLOW");

      // Verify Audit Event logged with dryRun: true
      const auditEvents = AuditLogger.getEvents({ taskId: "task_dry_1" });
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].dryRun).toBe(true);
      expect(auditEvents[0].actionType).toBe("click");
      expect(auditEvents[0].policyTier).toBe(PermissionTier.INTERACT);
    });

    it("should simulate type, clear, and scroll actions", async () => {
      const typeRes = await simulateBrowserAction("type", { text: "hello@world.com" }, { taskId: "t1", origin: "https://example.com" });
      expect(typeRes.success).toBe(true);
      expect(typeRes.dryRun).toBe(true);
      expect(typeRes.result?.charactersTyped).toBe(15);

      const clearRes = await simulateBrowserAction("clear", { elementId: "el_1" }, { taskId: "t1", origin: "https://example.com" });
      expect(clearRes.success).toBe(true);
      expect(clearRes.dryRun).toBe(true);

      const scrollRes = await simulateBrowserAction("scroll", { distanceY: 500 }, { taskId: "t1", origin: "https://example.com" });
      expect(scrollRes.success).toBe(true);
      expect(scrollRes.result?.distanceScrolled).toBe(500);
    });

    it("should fail simulation with STALE_ELEMENT when referencing non-existent or expired snapshot", async () => {
      const result = await simulateBrowserAction(
        "click",
        {
          elementId: "el_999",
          snapshotId: "snap_expired_999"
        },
        {
          taskId: "task_stale",
          origin: "https://example.com"
        }
      );

      expect(result.success).toBe(false);
      expect(result.dryRun).toBe(true);
      expect(result.error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);

      const auditEvents = AuditLogger.getEvents({ taskId: "task_stale" });
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].dryRun).toBe(true);
      expect(auditEvents[0].error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);
    });

    it("should reject navigation to unauthorized origin during dry-run", async () => {
      const result = await simulateBrowserAction(
        "navigate",
        { url: "https://unauthorized-evil.com/page" },
        {
          taskId: "task_origin",
          origin: "https://example.com",
          allowedOrigins: ["https://example.com", "https://api.example.com"]
        }
      );

      expect(result.success).toBe(false);
      expect(result.dryRun).toBe(true);
      expect(result.error?.code).toBe(BrowserErrorCode.ORIGIN_NOT_ALLOWED);
    });

    it("should reject action when security policy denies execution in dry-run", async () => {
      PolicyEngine.setStrictMode(true);

      const result = await simulateBrowserAction(
        "click",
        {
          elementText: "Permanently delete database account"
        },
        {
          taskId: "task_policy",
          origin: "https://example.com"
        }
      );

      expect(result.success).toBe(false);
      expect(result.dryRun).toBe(true);
      expect(result.policyDecision).toBe("DENY");
      expect(result.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);

      const events = AuditLogger.getEvents({ taskId: "task_policy" });
      expect(events[0].dryRun).toBe(true);
      expect(events[0].policyDecision).toBe("DENY");
    });
  });

  describe("Batch Action Simulation", () => {
    it("should simulate full batch of sequential actions when all succeed", async () => {
      const actions = [
        { action: "navigate", params: { url: "https://example.com/checkout" } },
        { action: "type", params: { text: "Jane Doe" } },
        { action: "scroll", params: { distanceY: 200 } }
      ];

      const batchResult = await simulateBrowserBatch(actions, {
        taskId: "task_batch_ok",
        origin: "https://example.com"
      });

      expect(batchResult.success).toBe(true);
      expect(batchResult.dryRun).toBe(true);
      expect(batchResult.totalActions).toBe(3);
      expect(batchResult.executedActions).toBe(3);
      expect(batchResult.results).toHaveLength(3);
      expect(batchResult.results[0].result?.navigatedUrl).toBe("https://example.com/checkout");

      const auditEvents = AuditLogger.getEvents({ taskId: "task_batch_ok" });
      expect(auditEvents).toHaveLength(3);
      expect(auditEvents.every(e => e.dryRun)).toBe(true);
    });

    it("should halt batch simulation on first failing action and return failedIndex", async () => {
      PolicyEngine.setStrictMode(true);

      const actions = [
        { action: "type", params: { text: "hello" } },
        { action: "click", params: { elementText: "Delete all user data forever" } }, // Will be DENIED in strict mode
        { action: "scroll", params: { distanceY: 100 } }
      ];

      const batchResult = await simulateBrowserBatch(actions, {
        taskId: "task_batch_fail",
        origin: "https://example.com"
      });

      expect(batchResult.success).toBe(false);
      expect(batchResult.dryRun).toBe(true);
      expect(batchResult.totalActions).toBe(3);
      expect(batchResult.executedActions).toBe(2);
      expect(batchResult.failedIndex).toBe(1);
      expect(batchResult.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);

      // Third action (scroll) should not have been simulated
      const auditEvents = AuditLogger.getEvents({ taskId: "task_batch_fail" });
      expect(auditEvents).toHaveLength(2);
    });
  });
});
