// Human Browser Runtime - Asynchronous Approval Broker & Human-in-the-Loop State Machine (M10)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { PermissionTierType } from "./contracts/policy.js";

export type ApprovalState = "PENDING" | "DISPATCHED" | "APPROVED" | "REJECTED" | "CANCELLED" | "TIMED_OUT" | "EXPIRED";

let requestSequence = 1;

export function generateRequestId(): string {
  const idStr = String(requestSequence++).padStart(6, "0");
  return `appr_${idStr}`;
}

export function resetRequestIdSequence(): void {
  requestSequence = 1;
}

export interface ApprovalRequest {
  requestId: string;
  actionId: string;
  taskId: string;
  tier: PermissionTierType;
  origin: string;
  actionType: string;
  reason: string;
  details?: Record<string, any>;
  state: ApprovalState;
  createdAt: number;
  timeoutMs: number;
  resolvedAt?: number;
  decisionBy?: string;
}

export interface CreateApprovalParams {
  actionId: string;
  taskId: string;
  tier: PermissionTierType;
  origin: string;
  actionType: string;
  reason: string;
  details?: Record<string, any>;
  timeoutMs?: number;
}

interface PendingHandle {
  request: ApprovalRequest;
  resolve: (value: { approved: boolean; decisionBy?: string }) => void;
  reject: (reason: any) => void;
  timer: any;
}

class ApprovalBrokerManager {
  private requests = new Map<string, ApprovalRequest>();
  private handles = new Map<string, PendingHandle>();
  private listeners: Array<(req: ApprovalRequest) => void> = [];

  public clear(): void {
    for (const [, handle] of this.handles.entries()) {
      clearTimeout(handle.timer);
    }
    this.requests.clear();
    this.handles.clear();
    resetRequestIdSequence();
  }

  public createApprovalRequest(params: CreateApprovalParams): { request: ApprovalRequest; promise: Promise<{ approved: boolean; decisionBy?: string }> } {
    const requestId = generateRequestId();
    const now = Date.now();
    const timeoutMs = params.timeoutMs || 60000;

    const request: ApprovalRequest = {
      requestId,
      actionId: params.actionId,
      taskId: params.taskId,
      tier: params.tier,
      origin: params.origin,
      actionType: params.actionType,
      reason: params.reason,
      details: params.details,
      state: "PENDING",
      createdAt: now,
      timeoutMs
    };

    this.requests.set(requestId, request);

    let resolvePromise: (val: { approved: boolean; decisionBy?: string }) => void;
    let rejectPromise: (err: any) => void;

    const promise = new Promise<{ approved: boolean; decisionBy?: string }>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timer = setTimeout(() => {
      this.handleTimeout(requestId);
    }, timeoutMs);

    this.handles.set(requestId, {
      request,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer
    });

    // Notify UI / Side Panel / CLI listeners
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch (e) {}
    }

    return { request, promise };
  }

  public resolveApproval(requestId: string, approved: boolean, decisionBy?: string): { success: boolean; request?: ApprovalRequest; error?: string } {
    const request = this.requests.get(requestId);

    if (!request) {
      return { success: false, error: `Approval request ${requestId} not found or already resolved.` };
    }

    if (request.state !== "PENDING" && request.state !== "DISPATCHED") {
      return { success: false, error: `Approval request ${requestId} not found or already resolved.` };
    }

    const handle = this.handles.get(requestId);
    if (!handle) {
      return { success: false, error: `Approval request ${requestId} not found or already resolved.` };
    }

    clearTimeout(handle.timer);
    this.handles.delete(requestId);

    request.state = approved ? "APPROVED" : "REJECTED";
    request.resolvedAt = Date.now();
    request.decisionBy = decisionBy || "user";

    if (approved) {
      handle.resolve({ approved: true, decisionBy: request.decisionBy });
    } else {
      handle.reject(
        new BrowserError(
          BrowserErrorCode.APPROVAL_REQUIRED,
          `Human approval was rejected by ${request.decisionBy} for action "${request.actionType}" on "${request.origin}".`,
          { requestId, actionId: request.actionId, taskId: request.taskId }
        )
      );
    }

    return { success: true, request };
  }

  private handleTimeout(requestId: string): void {
    const handle = this.handles.get(requestId);
    const request = this.requests.get(requestId);

    if (handle && request && (request.state === "PENDING" || request.state === "DISPATCHED")) {
      this.handles.delete(requestId);
      request.state = "EXPIRED";
      request.resolvedAt = Date.now();

      handle.reject(
        new BrowserError(
          BrowserErrorCode.APPROVAL_TIMEOUT,
          `Approval request ${requestId} for action "${request.actionType}" timed out after ${request.timeoutMs}ms.`,
          { requestId, actionId: request.actionId, timeoutMs: request.timeoutMs }
        )
      );
    }
  }

  public cancelPendingForTask(taskId: string): void {
    for (const [requestId, handle] of this.handles.entries()) {
      if (handle.request.taskId === taskId) {
        clearTimeout(handle.timer);
        this.handles.delete(requestId);

        handle.request.state = "CANCELLED";
        handle.request.resolvedAt = Date.now();

        handle.reject(
          new BrowserError(
            BrowserErrorCode.TASK_CANCELLED,
            `Approval request ${requestId} was cancelled because task ${taskId} was stopped/cancelled.`,
            { requestId, taskId }
          )
        );
      }
    }
  }

  public getPendingApprovals(taskId?: string): ApprovalRequest[] {
    const list: ApprovalRequest[] = [];
    for (const [, req] of this.requests.entries()) {
      if ((req.state === "PENDING" || req.state === "DISPATCHED") && (!taskId || req.taskId === taskId)) {
        list.push(req);
      }
    }
    return list;
  }

  public getApproval(requestId: string): ApprovalRequest | null {
    return this.requests.get(requestId) || null;
  }

  public subscribe(listener: (req: ApprovalRequest) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const ApprovalBroker = new ApprovalBrokerManager();

export function requestApproval(params: CreateApprovalParams) {
  return ApprovalBroker.createApprovalRequest(params);
}

export function resolveApprovalRequest(requestId: string, approved: boolean, decisionBy?: string) {
  return ApprovalBroker.resolveApproval(requestId, approved, decisionBy);
}

export function cancelPendingApprovalsForTask(taskId: string) {
  ApprovalBroker.cancelPendingForTask(taskId);
}
