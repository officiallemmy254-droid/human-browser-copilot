import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EventStreamer,
  matchesTopic,
  StreamEvent
} from "../../src/event_streamer.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import { TaskState } from "../../src/contracts/task.js";
import { AuditEvent } from "../../src/contracts/events.js";
import { ApprovalRequest } from "../../src/approval_broker.js";

describe("M22: Streaming and Events Subscription Registry", () => {
  beforeEach(() => {
    EventStreamer.clear();
  });

  describe("Topic Matching", () => {
    it("should match wildcard and specific topics correctly", () => {
      expect(matchesTopic("audit:action", "*")).toBe(true);
      expect(matchesTopic("audit:action", "**")).toBe(true);
      expect(matchesTopic("audit:action", "audit:*")).toBe(true);
      expect(matchesTopic("audit:error", "audit:*")).toBe(true);
      expect(matchesTopic("state:transition", "audit:*")).toBe(false);
      expect(matchesTopic("audit:action", "audit:action")).toBe(true);
      expect(matchesTopic("audit:action", "audit:click")).toBe(false);
    });
  });

  describe("Subscription & Emission", () => {
    it("should deliver published events to exact topic subscribers", () => {
      const received: StreamEvent[] = [];
      EventStreamer.subscribe("audit:action", (evt) => {
        received.push(evt);
      });

      EventStreamer.emit("audit:action", { actionType: "click", success: true });
      EventStreamer.emit("state:transition", { from: "IDLE", to: "EXECUTING" });

      expect(received).toHaveLength(1);
      expect(received[0].topic).toBe("audit:action");
      expect(received[0].data.actionType).toBe("click");
      expect(received[0].id).toMatch(/^sev_\d+$/);
    });

    it("should deliver events matching wildcard topic patterns (e.g. audit:*)", () => {
      const received: StreamEvent[] = [];
      EventStreamer.subscribe("audit:*", (evt) => {
        received.push(evt);
      });

      EventStreamer.emit("audit:action", { actionType: "type" });
      EventStreamer.emit("audit:error", { actionType: "navigate", error: "TIMEOUT" });
      EventStreamer.emit("state:transition", { from: "IDLE", to: "OBSERVING" });

      expect(received).toHaveLength(2);
      expect(received[0].topic).toBe("audit:action");
      expect(received[1].topic).toBe("audit:error");
    });

    it("should deliver all events to universal wildcard subscribers (*)", () => {
      const received: StreamEvent[] = [];
      EventStreamer.subscribe("*", (evt) => {
        received.push(evt);
      });

      EventStreamer.emit("topic_one", { val: 1 });
      EventStreamer.emit("topic_two", { val: 2 });

      expect(received).toHaveLength(2);
    });
  });

  describe("Domain Event Helpers", () => {
    it("should publish audit events with automatic topic routing (audit:action vs audit:error)", () => {
      const actions: StreamEvent[] = [];
      const errors: StreamEvent[] = [];

      EventStreamer.subscribe("audit:action", (evt) => actions.push(evt));
      EventStreamer.subscribe("audit:error", (evt) => errors.push(evt));

      const normalAudit: AuditEvent = {
        eventId: "evt_000001",
        timestamp: Date.now(),
        taskId: "task_1",
        actionId: "act_1",
        agentIdentity: "agent-1",
        origin: "https://example.com",
        actionType: "click",
        policyTier: PermissionTier.INTERACT,
        policyDecision: "ALLOW",
        approvalState: "NOT_REQUIRED",
        verificationStatus: "VERIFIED",
        dryRun: false
      };

      const errorAudit: AuditEvent = {
        eventId: "evt_000002",
        timestamp: Date.now(),
        taskId: "task_1",
        actionId: "act_2",
        agentIdentity: "agent-1",
        origin: "https://example.com",
        actionType: "navigate",
        policyTier: PermissionTier.READ,
        policyDecision: "ALLOW",
        approvalState: "NOT_REQUIRED",
        verificationStatus: "FAILED",
        error: { code: "TIMEOUT", message: "Page load timed out", retryable: true },
        dryRun: false
      };

      EventStreamer.publishAuditEvent(normalAudit);
      EventStreamer.publishAuditEvent(errorAudit);

      expect(actions).toHaveLength(1);
      expect(actions[0].data.eventId).toBe("evt_000001");

      expect(errors).toHaveLength(1);
      expect(errors[0].data.eventId).toBe("evt_000002");
    });

    it("should publish state transition events", () => {
      const transitions: StreamEvent[] = [];
      EventStreamer.subscribe("state:transition", (evt) => transitions.push(evt));

      EventStreamer.publishStateTransition("task_abc", TaskState.IDLE, TaskState.EXECUTING, {
        actionId: "act_001"
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].data.fromState).toBe(TaskState.IDLE);
      expect(transitions[0].data.toState).toBe(TaskState.EXECUTING);
      expect(transitions[0].taskId).toBe("task_abc");
    });

    it("should publish approval lifecycle events", () => {
      const approvals: StreamEvent[] = [];
      EventStreamer.subscribe("approval:*", (evt) => approvals.push(evt));

      const mockApproval: ApprovalRequest = {
        requestId: "appr_001",
        actionId: "act_001",
        taskId: "task_1",
        tier: PermissionTier.HIGH_RISK,
        origin: "https://bank.com",
        actionType: "click",
        reason: "Transfer $100",
        state: "PENDING",
        createdAt: Date.now(),
        timeoutMs: 30000
      };

      EventStreamer.publishApprovalEvent("requested", mockApproval);
      EventStreamer.publishApprovalEvent("resolved", { ...mockApproval, state: "APPROVED" });

      expect(approvals).toHaveLength(2);
      expect(approvals[0].topic).toBe("approval:requested");
      expect(approvals[1].topic).toBe("approval:resolved");
    });
  });

  describe("Subscription Filters & Controls", () => {
    it("should filter events by taskId and origin", () => {
      const received: StreamEvent[] = [];
      EventStreamer.subscribe(
        {
          topic: "audit:*",
          taskId: "task_target",
          origin: "https://allowed.com"
        },
        (evt) => received.push(evt)
      );

      EventStreamer.emit("audit:action", { data: 1 }, { taskId: "task_other", origin: "https://allowed.com" });
      EventStreamer.emit("audit:action", { data: 2 }, { taskId: "task_target", origin: "https://other.com" });
      EventStreamer.emit("audit:action", { data: 3 }, { taskId: "task_target", origin: "https://allowed.com" });

      expect(received).toHaveLength(1);
      expect(received[0].data.data).toBe(3);
    });

    it("should pause, resume, and unsubscribe subscriptions", () => {
      const received: StreamEvent[] = [];
      const handle = EventStreamer.subscribe("audit:action", (evt) => received.push(evt));

      expect(handle.isActive()).toBe(true);
      expect(handle.isPaused()).toBe(false);

      EventStreamer.emit("audit:action", { seq: 1 });
      expect(received).toHaveLength(1);

      handle.pause();
      expect(handle.isPaused()).toBe(true);
      EventStreamer.emit("audit:action", { seq: 2 });
      expect(received).toHaveLength(1); // Ignored while paused

      handle.resume();
      expect(handle.isPaused()).toBe(false);
      EventStreamer.emit("audit:action", { seq: 3 });
      expect(received).toHaveLength(2);

      handle.unsubscribe();
      expect(handle.isActive()).toBe(false);
      EventStreamer.emit("audit:action", { seq: 4 });
      expect(received).toHaveLength(2); // Ignored after unsubscribe
    });
  });

  describe("History Replay & Resilience", () => {
    it("should record event history and support replay for new subscribers", () => {
      EventStreamer.emit("audit:action", { val: "A" });
      EventStreamer.emit("audit:action", { val: "B" });
      EventStreamer.emit("state:transition", { val: "C" });

      const replayed: StreamEvent[] = [];
      const handle = EventStreamer.subscribe("audit:*", (evt) => replayed.push(evt));

      const count = EventStreamer.replay(handle);
      expect(count).toBe(2);
      expect(replayed).toHaveLength(2);
      expect(replayed[0].data.val).toBe("A");
      expect(replayed[1].data.val).toBe("B");
    });

    it("should isolate subscriber errors and continue notifying others", () => {
      const goodReceived: StreamEvent[] = [];

      EventStreamer.subscribe("audit:action", () => {
        throw new Error("Broken listener");
      });

      EventStreamer.subscribe("audit:action", (evt) => {
        goodReceived.push(evt);
      });

      expect(() => {
        EventStreamer.emit("audit:action", { ok: true });
      }).not.toThrow();

      expect(goodReceived).toHaveLength(1);
      expect(goodReceived[0].data.ok).toBe(true);
    });
  });
});
