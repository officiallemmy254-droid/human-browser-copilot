import { describe, it, expect } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  verifyTypeAction,
  verifyCheckedState,
  verifyUrlChanged,
  verifyElementPresence
} from "../../src/action_verifier.js";

describe("M11: Action Verification & Post-State Validation", () => {
  it("should successfully verify typing when input value matches expected text", async () => {
    const mockEvaluator = async () => "admin@example.com";

    const res = await verifyTypeAction("input#email", "admin@example.com", mockEvaluator);
    expect(res.verified).toBe(true);
    expect(res.status).toBe("VERIFIED");
    expect(res.actualValue).toBe("admin@example.com");
  });

  it("should fail with VERIFICATION_FAILED when input value does not match (e.g. blocked/readonly input)", async () => {
    const mockEvaluator = async () => ""; // Element remained empty

    const res = await verifyTypeAction("input#email", "admin@example.com", mockEvaluator);
    expect(res.verified).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.error?.code).toBe(BrowserErrorCode.VERIFICATION_FAILED);
    expect(res.error?.message).toContain("Verification failed for type action on \"input#email\"");
  });

  it("should verify checked state of checkbox/toggle", async () => {
    const mockEvaluatorTrue = async () => true;
    const mockEvaluatorFalse = async () => false;

    const resTrue = await verifyCheckedState("input#terms", true, mockEvaluatorTrue);
    expect(resTrue.verified).toBe(true);
    expect(resTrue.status).toBe("VERIFIED");

    const resFail = await verifyCheckedState("input#terms", true, mockEvaluatorFalse);
    expect(resFail.verified).toBe(false);
    expect(resFail.status).toBe("FAILED");
    expect(resFail.error?.code).toBe(BrowserErrorCode.VERIFICATION_FAILED);
  });

  it("should verify URL change after navigation or link click", async () => {
    const mockEvaluator = async () => "https://example.com/checkout/success";

    const resPass = await verifyUrlChanged("/checkout/success", mockEvaluator);
    expect(resPass.verified).toBe(true);
    expect(resPass.status).toBe("VERIFIED");

    const resFail = await verifyUrlChanged("/dashboard", mockEvaluator);
    expect(resFail.verified).toBe(false);
    expect(resFail.status).toBe("FAILED");
    expect(resFail.error?.code).toBe(BrowserErrorCode.VERIFICATION_FAILED);
  });

  it("should verify element appearance or disappearance", async () => {
    const mockEvaluatorPresent = async () => true;
    const mockEvaluatorAbsent = async () => false;

    const resPresent = await verifyElementPresence("div.modal", true, mockEvaluatorPresent);
    expect(resPresent.verified).toBe(true);
    expect(resPresent.status).toBe("VERIFIED");

    const resAbsent = await verifyElementPresence("div.spinner", false, mockEvaluatorAbsent);
    expect(resAbsent.verified).toBe(true);
    expect(resAbsent.status).toBe("VERIFIED");
  });
});
