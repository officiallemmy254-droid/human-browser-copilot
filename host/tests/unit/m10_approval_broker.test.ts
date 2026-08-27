import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import {
  ApprovalBroker,
  requestApproval,
  resolveApprovalRequest,
  cancelPendingApprovalsForTask
} from "../../src/approval_broker.js";

describe("M10: Approval Broker & Asynchronous Human-in-the-Loop State Machine", () => {
  beforeEach(() => {
    ApprovalBroker.clear();
  });

  it("should create approval request in PENDING state with sequential requestId", () => {
    const { request } = requestApproval({
      actionId: "action_000001",
      taskId: "task_1",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://bank.com",
      actionType: "click",
      reason: "Confirm financial transfer of $500",
      timeoutMs: 5000
    });

    expect(request.requestId).toMatch(/^appr_\d+$/);
    expect(request.state).toBe("PENDING");
    expect(request.actionId).toBe("action_000001");
    expect(request.tier).toBe(PermissionTier.HIGH_RISK);

    const pending = ApprovalBroker.getPendingApprovals("task_1");
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe(request.requestId);
  });

  it("should resolve approval request when user approves", async () => {
    const { request, promise } = requestApproval({
      actionId: "action_000002",
      taskId: "task_1",
      tier: PermissionTier.EXTERNAL_SIDE_EFFECT,
      origin: "https://social.example.com",
      actionType: "click",
      reason: "Post public message to feed"
    });

    // Simulate user approving via Side Panel / UI
    const resolveResult = resolveApprovalRequest(request.requestId, true, "user-admin");
    expect(resolveResult.success).toBe(true);
    expect(resolveResult.request?.state).toBe("APPROVED");
    expect(resolveResult.request?.decisionBy).toBe("user-admin");

    // The waiting promise must resolve with approval
    const outcome = await promise;
    expect(outcome.approved).toBe(true);
  });

  it("should reject waiting promise when user denies approval", async () => {
    const { request, promise } = requestApproval({
      actionId: "action_000003",
      taskId: "task_1",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://shop.example.com",
      actionType: "click",
      reason: "Confirm payment"
    });

    resolveApprovalRequest(request.requestId, false, "user-admin");

    await expect(promise).rejects.toMatchObject({
      code: BrowserErrorCode.APPROVAL_REQUIRED
    });
  });

  it("should prevent double-resolution of approval requests atomically", () => {
    const { request } = requestApproval({
      actionId: "action_000004",
      taskId: "task_1",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://bank.com",
      actionType: "click",
      reason: "Transfer funds"
    });

    const first = resolveApprovalRequest(request.requestId, true);
    expect(first.success).toBe(true);

    // Second resolution must fail
    const second = resolveApprovalRequest(request.requestId, false);
    expect(second.success).toBe(false);
    expect(second.error).toContain("already resolved");
  });

  it("should trigger APPROVAL_TIMEOUT when approval is not resolved before deadline", async () => {
    const { promise } = requestApproval({
      actionId: "action_000005",
      taskId: "task_timeout",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://sensitive.com",
      actionType: "click",
      reason: "Sensitive action",
      timeoutMs: 50
    });

    await expect(promise).rejects.toMatchObject({
      code: BrowserErrorCode.APPROVAL_TIMEOUT
    });
  });

  it("should transition pending approvals to CANCELLED on task termination", async () => {
    const { request, promise } = requestApproval({
      actionId: "action_000006",
      taskId: "task_cancelled",
      tier: PermissionTier.HIGH_RISK,
      origin: "https://site.com",
      actionType: "click",
      reason: "Action to cancel"
    });

    cancelPendingApprovalsForTask("task_cancelled");

    const reqState = ApprovalBroker.getApproval(request.requestId);
    expect(reqState?.state).toBe("CANCELLED");

    await expect(promise).rejects.toMatchObject({
      code: BrowserErrorCode.TASK_CANCELLED
    });
  });
});
