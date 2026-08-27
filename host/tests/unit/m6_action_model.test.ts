import { describe, it, expect, beforeEach } from "vitest";
import { generateActionId, resetActionIdSequence } from "../../src/contracts/actions.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import { AuditLogger, recordActionAudit } from "../../src/audit_logger.js";

describe("M6: Action Model & Audit Logging", () => {
  beforeEach(() => {
    resetActionIdSequence();
    AuditLogger.clear();
  });

  it("should generate sequential, formatted action IDs", () => {
    expect(generateActionId()).toBe("action_000001");
    expect(generateActionId()).toBe("action_000002");
    expect(generateActionId()).toBe("action_000003");
  });

  it("should capture complete action metadata in audit log", () => {
    const actionId = generateActionId();
    const event = recordActionAudit({
      taskId: "task_100",
      actionId,
      agentIdentity: "antigravity-agent",
      origin: "https://example.com",
      tabId: 1,
      actionType: "click",
      policyTier: PermissionTier.INTERACT,
      policyDecision: "ALLOW",
      approvalState: "NOT_REQUIRED",
      executionResult: { clicked: true, x: 120, y: 340 },
      verificationStatus: "VERIFIED"
    });

    expect(event.eventId).toMatch(/^evt_\d+$/);
    expect(event.actionId).toBe("action_000001");
    expect(event.taskId).toBe("task_100");
    expect(event.actionType).toBe("click");
    expect(event.verificationStatus).toBe("VERIFIED");
    expect(event.timestamp).toBeGreaterThan(0);

    const logs = AuditLogger.getEvents({ taskId: "task_100" });
    expect(logs).toHaveLength(1);
    expect(logs[0].actionId).toBe("action_000001");
  });

  it("should never log secrets in audit records (M20)", () => {
    const event = recordActionAudit({
      taskId: "task_sensitive",
      actionId: generateActionId(),
      origin: "https://bank.example.com",
      actionType: "type",
      policyTier: PermissionTier.INTERACT,
      policyDecision: "ALLOW",
      executionResult: {
        rawInput: "password: secretPassWord999!",
        authHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
      }
    });

    const eventJson = JSON.stringify(event);
    expect(eventJson).not.toContain("secretPassWord999!");
    expect(eventJson).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(eventJson).toContain("[REDACTED]");
  });

  it("should filter audit events by taskId and actionId", () => {
    recordActionAudit({ taskId: "task_A", actionId: generateActionId(), origin: "https://a.com", actionType: "navigate", policyTier: PermissionTier.INTERACT, policyDecision: "ALLOW" });
    recordActionAudit({ taskId: "task_B", actionId: generateActionId(), origin: "https://b.com", actionType: "observe", policyTier: PermissionTier.READ, policyDecision: "ALLOW" });
    recordActionAudit({ taskId: "task_A", actionId: generateActionId(), origin: "https://a.com", actionType: "click", policyTier: PermissionTier.INTERACT, policyDecision: "ALLOW" });

    expect(AuditLogger.getEvents({ taskId: "task_A" })).toHaveLength(2);
    expect(AuditLogger.getEvents({ taskId: "task_B" })).toHaveLength(1);
    expect(AuditLogger.getEvents({ actionId: "action_000002" })).toHaveLength(1);
  });
});
