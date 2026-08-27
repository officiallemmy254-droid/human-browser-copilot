// Human Browser Runtime - Canonical Error Taxonomy & Deterministic Error Mapper (M12, M20)
import { BrowserError, BrowserErrorCode, BrowserErrorCodeType } from "./contracts/errors.js";

const RETRYABLE_CODES = new Set<BrowserErrorCodeType>([
  BrowserErrorCode.TIMEOUT,
  BrowserErrorCode.STALE_ELEMENT,
  BrowserErrorCode.MODAL_BLOCKING,
  BrowserErrorCode.DEBUGGER_CONFLICT,
  BrowserErrorCode.UNKNOWN_ERROR
]);

export function isRetryableErrorCode(code: BrowserErrorCodeType): boolean {
  return RETRYABLE_CODES.has(code);
}

/**
 * Strips internal paths, stack traces, and tokens from diagnostic error messages
 */
export function sanitizeDiagnosticMessage(msg: string): string {
  if (!msg) return "";

  return msg
    // Strip Windows and POSIX absolute file paths
    .replace(/[a-zA-Z]:\\[^:\s\n]+/g, "[PATH]")
    .replace(/\/(?:Users|home|root|var|etc|usr|opt)\/[^\s:\n]+/g, "[PATH]")
    // Strip stack trace frames
    .replace(/^\s+at\s+.+$/gm, "")
    // Strip sensitive keys & credentials
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)[^\s,]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
    .replace(/(key\s*[:=]\s*)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
    .replace(/(cookie\s*[:=]\s*)[^\s;]+/gi, "$1[REDACTED]")
    .trim();
}

export function createCanonicalError(
  code: BrowserErrorCodeType,
  message: string,
  details?: Record<string, any>,
  retryable?: boolean
): BrowserError {
  const isRetry = retryable !== undefined ? retryable : isRetryableErrorCode(code);
  const cleanMsg = sanitizeDiagnosticMessage(message);
  return new BrowserError(code, cleanMsg, details, isRetry);
}

export function mapErrorToCanonical(err: unknown): BrowserError {
  if (err instanceof BrowserError) {
    return new BrowserError(
      err.code,
      sanitizeDiagnosticMessage(err.message),
      err.details,
      err.retryable
    );
  }

  const rawMsg = err instanceof Error ? err.message : String(err || "");
  const lower = rawMsg.toLowerCase();

  let code: BrowserErrorCodeType = BrowserErrorCode.UNKNOWN_ERROR;

  if (lower.includes("another debugger") || lower.includes("already debugged") || lower.includes("cannot attach to existing target") || lower.includes("detached by user")) {
    code = BrowserErrorCode.DEBUGGER_CONFLICT;
  } else if (lower.includes("no tab with id") || lower.includes("no tab found") || lower.includes("tab not found") || lower.includes("tab was closed") || lower.includes("target.detached") || lower.includes("detachedfromtarget") || lower.includes("page has been closed") || lower.includes("target detached") || lower.includes("session closed") || lower.includes("connection dropped")) {
    code = BrowserErrorCode.TAB_NOT_FOUND;
  } else if (lower.includes("tab is locked") || lower.includes("already locked")) {
    code = BrowserErrorCode.TAB_LOCKED;
  } else if (lower.includes("no node with given id") || lower.includes("node is detached") || lower.includes("stale element") || lower.includes("no longer connected")) {
    code = BrowserErrorCode.STALE_ELEMENT;
  } else if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("waiting for selector")) {
    code = BrowserErrorCode.TIMEOUT;
  } else if (lower.includes("dialog alert") || lower.includes("modal blocking") || lower.includes("unexpected modal") || lower.includes("dialog is open")) {
    code = BrowserErrorCode.MODAL_BLOCKING;
  } else if (lower.includes("captcha") || lower.includes("cloudflare") || lower.includes("human required") || lower.includes("human intervention")) {
    code = BrowserErrorCode.HUMAN_REQUIRED;
  } else if (lower.includes("origin not allowed") || lower.includes("blocked by origin") || lower.includes("origin allowlist") || lower.includes("origin is not") || lower.includes("allowlist")) {
    code = BrowserErrorCode.ORIGIN_NOT_ALLOWED;
  } else if (lower.includes("policy denied") || lower.includes("security policy") || lower.includes("forbidden by policy")) {
    code = BrowserErrorCode.POLICY_DENIED;
  } else if (lower.includes("approval required") || lower.includes("human approval was rejected") || lower.includes("approval rejected")) {
    code = BrowserErrorCode.APPROVAL_REQUIRED;
  } else if (lower.includes("approval timeout") || lower.includes("approval timed out")) {
    code = BrowserErrorCode.APPROVAL_TIMEOUT;
  } else if (lower.includes("authentication required") || lower.includes("invalid session token") || lower.includes("session token has expired")) {
    code = BrowserErrorCode.AUTHENTICATION_REQUIRED;
  } else if (lower.includes("verification failed")) {
    code = BrowserErrorCode.VERIFICATION_FAILED;
  } else if (lower.includes("invalid state") || lower.includes("invalid task transition")) {
    code = BrowserErrorCode.INVALID_STATE;
  } else if (lower.includes("task was cancelled") || lower.includes("task stopped") || lower.includes("cancelled")) {
    code = BrowserErrorCode.TASK_CANCELLED;
  } else if (lower.includes("unsupported operation") || lower.includes("not supported")) {
    code = BrowserErrorCode.UNSUPPORTED_OPERATION;
  }

  return createCanonicalError(code, rawMsg, undefined, isRetryableErrorCode(code));
}
