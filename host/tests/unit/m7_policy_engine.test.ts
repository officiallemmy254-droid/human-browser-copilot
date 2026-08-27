import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import { PolicyEngine, evaluatePolicy, enforcePolicy } from "../../src/policy_engine.js";

describe("M7: Policy Engine & Permission Tiers", () => {
  beforeEach(() => {
    PolicyEngine.resetToDefaults();
  });

  it("should evaluate READ tier actions as ALLOW by default", () => {
    const evalResult = evaluatePolicy({
      origin: "https://example.com",
      actionType: "observe"
    });

    expect(evalResult.tier).toBe(PermissionTier.READ);
    expect(evalResult.decision).toBe("ALLOW");
  });

  it("should evaluate INTERACT tier actions as ALLOW by default", () => {
    const evalResult = evaluatePolicy({
      origin: "https://example.com",
      actionType: "type",
      targetSelector: "input#search"
    });

    expect(evalResult.tier).toBe(PermissionTier.INTERACT);
    expect(evalResult.decision).toBe("ALLOW");
  });

  it("should escalate button click with financial keywords to HIGH_RISK and require approval (PROMPT)", () => {
    const evalResult = evaluatePolicy({
      origin: "https://shop.example.com",
      actionType: "click",
      targetText: "Pay Now $499.00"
    });

    expect(evalResult.tier).toBe(PermissionTier.HIGH_RISK);
    expect(evalResult.decision).toBe("PROMPT");
    expect(evalResult.reason).toContain("financial or sensitive action");
  });

  it("should escalate delete/wipe actions to EXTERNAL_SIDE_EFFECT / HIGH_RISK", () => {
    const evalResult = evaluatePolicy({
      origin: "https://app.example.com",
      actionType: "click",
      targetText: "Delete Project Forever"
    });

    expect(evalResult.tier).toBe(PermissionTier.HIGH_RISK);
    expect(evalResult.decision).toBe("PROMPT");
  });

  it("should enforce custom DENY rule and return POLICY_DENIED error", () => {
    PolicyEngine.addRule({
      originPattern: "https://untrusted.example.com",
      actionType: "*",
      decision: "DENY",
      reason: "Untrusted origin blacklisted by policy"
    });

    const enforcement = enforcePolicy({
      origin: "https://untrusted.example.com",
      actionType: "click"
    });

    expect(enforcement.allowed).toBe(false);
    expect(enforcement.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);
    expect(enforcement.error?.message).toContain("Untrusted origin blacklisted");
  });

  it("should enforce strict mode where HIGH_RISK is DENIED by default", () => {
    PolicyEngine.setStrictMode(true);

    const enforcement = enforcePolicy({
      origin: "https://example.com",
      actionType: "click",
      targetText: "Transfer $1,000 to Account"
    });

    expect(enforcement.allowed).toBe(false);
    expect(enforcement.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);
  });
});
