import { describe, it, expect } from "vitest";
import { BrowserErrorCode, BrowserError, sanitizeErrorMessage, toBrowserError } from "../../src/contracts/errors.js";

describe("M12: Canonical Error Taxonomy", () => {
  it("should contain all 17 canonical error codes", () => {
    const requiredCodes = [
      "STALE_ELEMENT",
      "TAB_NOT_FOUND",
      "TAB_LOCKED",
      "DEBUGGER_CONFLICT",
      "TIMEOUT",
      "INVALID_STATE",
      "TASK_CANCELLED",
      "POLICY_DENIED",
      "APPROVAL_REQUIRED",
      "APPROVAL_TIMEOUT",
      "HUMAN_REQUIRED",
      "MODAL_BLOCKING",
      "ORIGIN_NOT_ALLOWED",
      "AUTHENTICATION_REQUIRED",
      "VERIFICATION_FAILED",
      "UNSUPPORTED_OPERATION",
      "UNKNOWN_ERROR"
    ];

    expect(Object.keys(BrowserErrorCode)).toHaveLength(17);
    for (const code of requiredCodes) {
      expect(BrowserErrorCode[code as keyof typeof BrowserErrorCode]).toBe(code);
    }
  });

  it("should format typed BrowserError correctly", () => {
    const err = new BrowserError(BrowserErrorCode.STALE_ELEMENT, "Element el_1 is no longer in DOM", { elementId: "el_1" });
    expect(err.code).toBe("STALE_ELEMENT");
    expect(err.message).toBe("Element el_1 is no longer in DOM");
    expect(err.details).toEqual({ elementId: "el_1" });
    expect(err.retryable).toBe(false);

    const json = err.toJSON();
    expect(json.code).toBe("STALE_ELEMENT");
    expect(json.message).toBe("Element el_1 is no longer in DOM");
  });

  it("should redact authorization tokens, passwords, and cookies from error messages", () => {
    const rawMsg = "Failed connecting with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and password: supersecretpassword123";
    const sanitized = sanitizeErrorMessage(rawMsg);
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(sanitized).not.toContain("supersecretpassword123");
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("password: [REDACTED]");
  });

  it("should convert arbitrary unknown exceptions to typed UNKNOWN_ERROR", () => {
    const rawError = new Error("Socket disconnected unexpectedly");
    const browserErr = toBrowserError(rawError);
    expect(browserErr.code).toBe(BrowserErrorCode.UNKNOWN_ERROR);
    expect(browserErr.message).toBe("Socket disconnected unexpectedly");
  });
});
