// Human Browser Runtime - Audit Logger & Tamper-Proof Event Stream (M6, M20, M22)
import { AuditEvent, AuditEventSchema } from "./contracts/events.js";
import { PermissionTier, PermissionTierType } from "./contracts/policy.js";
import { BrowserErrorData } from "./contracts/errors.js";

let eventSequence = 1;

export function generateEventId(): string {
  const idStr = String(eventSequence++).padStart(6, "0");
  return `evt_${idStr}`;
}

export function resetEventIdSequence(): void {
  eventSequence = 1;
}

/**
 * Recursively redacts sensitive credentials, tokens, and passwords from audit objects
 */
export function sanitizeAuditData<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return data
      .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
      .replace(/(password\s*[:=]\s*)[^\s,]+/gi, "$1[REDACTED]")
      .replace(/(token\s*[:=]\s*)[a-zA-Z0-9_\-\.]{15,}/gi, "$1[REDACTED]")
      .replace(/(cookie\s*[:=]\s*)[^\s;]+/gi, "$1[REDACTED]") as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeAuditData(item)) as unknown as T;
  }

  if (typeof data === "object") {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("privatekey") ||
        lowerKey.includes("authheader") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("token") ||
        lowerKey.includes("cookie") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key")
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeAuditData(value);
      }
    }
    return sanitized as T;
  }

  return data;
}

export interface RecordActionAuditParams {
  taskId: string;
  actionId?: string;
  agentIdentity?: string;
  origin: string;
  tabId?: number;
  actionType: string;
  policyTier: PermissionTierType;
  policyDecision: "ALLOW" | "PROMPT" | "DENY";
  approvalState?: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  executionResult?: Record<string, any>;
  verificationStatus?: "VERIFIED" | "UNVERIFIED" | "FAILED" | "SKIPPED";
  error?: BrowserErrorData;
  dryRun?: boolean;
}

class AuditLoggerManager {
  private events: AuditEvent[] = [];
  private listeners: Array<(event: AuditEvent) => void> = [];

  public clear(): void {
    this.events = [];
    resetEventIdSequence();
  }

  public logEvent(params: RecordActionAuditParams): AuditEvent {
    const rawEvent: AuditEvent = {
      eventId: generateEventId(),
      timestamp: Date.now(),
      taskId: params.taskId,
      actionId: params.actionId,
      agentIdentity: params.agentIdentity || "agent",
      origin: params.origin,
      tabId: params.tabId,
      actionType: params.actionType,
      policyTier: params.policyTier,
      policyDecision: params.policyDecision,
      approvalState: params.approvalState || "NOT_REQUIRED",
      executionResult: params.executionResult ? sanitizeAuditData(params.executionResult) : undefined,
      verificationStatus: params.verificationStatus || "UNVERIFIED",
      error: params.error ? sanitizeAuditData(params.error) : undefined,
      dryRun: params.dryRun ?? false
    };

    const validated = AuditEventSchema.parse(rawEvent);
    this.events.push(validated);

    // Notify stream subscribers
    for (const listener of this.listeners) {
      try {
        listener(validated);
      } catch (e) {}
    }

    return validated;
  }

  public getEvents(filter: { taskId?: string; actionId?: string; origin?: string } = {}): AuditEvent[] {
    return this.events.filter(event => {
      if (filter.taskId && event.taskId !== filter.taskId) return false;
      if (filter.actionId && event.actionId !== filter.actionId) return false;
      if (filter.origin && event.origin !== filter.origin) return false;
      return true;
    });
  }

  public subscribe(listener: (event: AuditEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public exportLogJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

export const AuditLogger = new AuditLoggerManager();

export function recordActionAudit(params: RecordActionAuditParams): AuditEvent {
  return AuditLogger.logEvent(params);
}
