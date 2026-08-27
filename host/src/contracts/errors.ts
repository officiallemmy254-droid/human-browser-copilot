// Canonical Error Taxonomy for AI Browser Runtime (M12)
import { z } from "zod";

export const BrowserErrorCode = {
  STALE_ELEMENT: "STALE_ELEMENT",
  TAB_NOT_FOUND: "TAB_NOT_FOUND",
  TAB_LOCKED: "TAB_LOCKED",
  DEBUGGER_CONFLICT: "DEBUGGER_CONFLICT",
  TIMEOUT: "TIMEOUT",
  INVALID_STATE: "INVALID_STATE",
  TASK_CANCELLED: "TASK_CANCELLED",
  POLICY_DENIED: "POLICY_DENIED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_TIMEOUT: "APPROVAL_TIMEOUT",
  HUMAN_REQUIRED: "HUMAN_REQUIRED",
  MODAL_BLOCKING: "MODAL_BLOCKING",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
} as const;

export type BrowserErrorCodeType = typeof BrowserErrorCode[keyof typeof BrowserErrorCode];

export const BrowserErrorSchema = z.object({
  code: z.nativeEnum(BrowserErrorCode),
  message: z.string(),
  details: z.record(z.any()).optional(),
  retryable: z.boolean().default(false)
});

export type BrowserErrorData = z.infer<typeof BrowserErrorSchema>;

export class BrowserError extends Error {
  public readonly code: BrowserErrorCodeType;
  public readonly details?: Record<string, any>;
  public readonly retryable: boolean;

  constructor(code: BrowserErrorCodeType, message: string, details?: Record<string, any>, retryable: boolean = false) {
    super(sanitizeErrorMessage(message));
    this.name = "BrowserError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    Object.setPrototypeOf(this, BrowserError.prototype);
  }

  public toJSON(): BrowserErrorData {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable
    };
  }
}

/**
 * Strips authorization headers, tokens, and sensitive strings from error messages
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)[^\s,]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
    .replace(/(cookie\s*[:=]\s*)[^\s;]+/gi, "$1[REDACTED]");
}

export function toBrowserError(err: unknown): BrowserError {
  if (err instanceof BrowserError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err || "");
  const lower = msg.toLowerCase();

  if (lower.includes("another debugger") || lower.includes("already debugged") || lower.includes("cannot attach to existing target") || lower.includes("detached by user")) {
    return new BrowserError(BrowserErrorCode.DEBUGGER_CONFLICT, msg, undefined, true);
  }
  if (lower.includes("detachedfromtarget") || lower.includes("session closed") || lower.includes("no tab with id") || lower.includes("no tab found") || lower.includes("tab not found") || lower.includes("tab was closed") || lower.includes("connection dropped")) {
    return new BrowserError(BrowserErrorCode.TAB_NOT_FOUND, msg, undefined, false);
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("waiting for selector")) {
    return new BrowserError(BrowserErrorCode.TIMEOUT, msg, undefined, true);
  }
  if (lower.includes("stale element") || lower.includes("no node with given id") || lower.includes("node is detached")) {
    return new BrowserError(BrowserErrorCode.STALE_ELEMENT, msg, undefined, true);
  }
  if (lower.includes("origin not allowed") || lower.includes("blocked by origin") || lower.includes("origin allowlist")) {
    return new BrowserError(BrowserErrorCode.ORIGIN_NOT_ALLOWED, msg, undefined, false);
  }
  if (lower.includes("policy denied") || lower.includes("security policy") || lower.includes("forbidden by policy")) {
    return new BrowserError(BrowserErrorCode.POLICY_DENIED, msg, undefined, false);
  }

  return new BrowserError(BrowserErrorCode.UNKNOWN_ERROR, msg || "An unexpected error occurred");
}
