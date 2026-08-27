import { describe, it, expect } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  mapErrorToCanonical,
  createCanonicalError,
  isRetryableErrorCode,
  sanitizeDiagnosticMessage
} from "../../src/error_mapper.js";

describe("M12: Canonical Error Taxonomy & Deterministic Mapping", () => {
  it("should classify all 17 canonical error codes deterministically", () => {
    const allCodes = Object.values(BrowserErrorCode);
    expect(allCodes).toHaveLength(17);

    for (const code of allCodes) {
      const err = createCanonicalError(code, `Test message for ${code}`);
      expect(err.code).toBe(code);
      expect(err.message).toBe(`Test message for ${code}`);
      expect(typeof err.retryable).toBe("boolean");
    }
  });

  it("should map raw CDP and Chrome extension errors to canonical codes", () => {
    expect(mapErrorToCanonical(new Error("Cannot attach to existing target: tab is already debugged")).code).toBe(BrowserErrorCode.DEBUGGER_CONFLICT);
    expect(mapErrorToCanonical(new Error("No tab with id: 999")).code).toBe(BrowserErrorCode.TAB_NOT_FOUND);
    expect(mapErrorToCanonical(new Error("No node with given id found in document context")).code).toBe(BrowserErrorCode.STALE_ELEMENT);
    expect(mapErrorToCanonical(new Error("Timeout waiting for selector \"button#submit\" after 30000ms")).code).toBe(BrowserErrorCode.TIMEOUT);
    expect(mapErrorToCanonical(new Error("Blocked by security policy: action is forbidden")).code).toBe(BrowserErrorCode.POLICY_DENIED);
    expect(mapErrorToCanonical(new Error("Navigation blocked: Origin is not in allowlist")).code).toBe(BrowserErrorCode.ORIGIN_NOT_ALLOWED);
    expect(mapErrorToCanonical(new Error("Human approval required before submitting order")).code).toBe(BrowserErrorCode.APPROVAL_REQUIRED);
    expect(mapErrorToCanonical(new Error("JavaScript dialog alert() is blocking page interaction")).code).toBe(BrowserErrorCode.MODAL_BLOCKING);
    expect(mapErrorToCanonical(new Error("CAPTCHA challenge detected on page")).code).toBe(BrowserErrorCode.HUMAN_REQUIRED);
  });

  it("should correctly identify retryable vs non-retryable error codes", () => {
    // Retryable
    expect(isRetryableErrorCode(BrowserErrorCode.TIMEOUT)).toBe(true);
    expect(isRetryableErrorCode(BrowserErrorCode.STALE_ELEMENT)).toBe(true);
    expect(isRetryableErrorCode(BrowserErrorCode.MODAL_BLOCKING)).toBe(true);

    // Non-retryable
    expect(isRetryableErrorCode(BrowserErrorCode.POLICY_DENIED)).toBe(false);
    expect(isRetryableErrorCode(BrowserErrorCode.AUTHENTICATION_REQUIRED)).toBe(false);
    expect(isRetryableErrorCode(BrowserErrorCode.APPROVAL_REQUIRED)).toBe(false);
    expect(isRetryableErrorCode(BrowserErrorCode.ORIGIN_NOT_ALLOWED)).toBe(false);
  });

  it("should sanitize file system paths and stack traces from error messages", () => {
    const raw = "Error at C:\\Users\\SIR\\human-browser\\host\\src\\index.ts:12:4 with token=superSecret123456789";
    const sanitized = sanitizeDiagnosticMessage(raw);

    expect(sanitized).not.toContain("C:\\Users\\SIR");
    expect(sanitized).not.toContain("superSecret123456789");
    expect(sanitized).toContain("[PATH]");
    expect(sanitized).toContain("[REDACTED]");
  });
});
