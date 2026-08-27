// Human Browser Runtime - CDP Debugger Conflict & Resource Recovery Manager (M18)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { TaskState } from "./contracts/task.js";
import { TaskManager, transitionTaskState, getTaskContext } from "./task_state_machine.js";
import { releaseTabLock, releaseAllLocksForTask, TabLockManager } from "./tab_lock_manager.js";
import { cancelPendingApprovalsForTask } from "./approval_broker.js";
import { recordActionAudit } from "./audit_logger.js";
import { PermissionTier } from "./contracts/policy.js";

export interface TabSessionInfo {
  tabId: number;
  taskId: string;
  attachedAt: number;
  metadata?: Record<string, any>;
}

export interface DebuggerConflictResult {
  tabId: number;
  taskId?: string;
  conflictDetected: boolean;
  reason: string;
  error: BrowserError;
  releasedLock: boolean;
  timestamp: number;
}

export interface DebuggerConflictEvent {
  tabId: number;
  taskId?: string;
  reason: string;
  timestamp: number;
  error: BrowserError;
}

const DEBUGGER_CONFLICT_PATTERNS = [
  "replaced_with_devtools",
  "another debugger",
  "already debugged",
  "cannot attach to existing target",
  "detached by user",
  "target closed",
  "session closed. most likely the page has been closed or another debugger attached",
  "target_closed"
];

class DebuggerConflictController {
  private activeSessions = new Map<number, TabSessionInfo>();
  private conflictTabs = new Set<number>();
  private listeners: Array<(event: DebuggerConflictEvent) => void> = [];

  public clear(): void {
    this.activeSessions.clear();
    this.conflictTabs.clear();
  }

  public registerTabSession(tabId: number, taskId: string, metadata?: Record<string, any>): void {
    this.activeSessions.set(tabId, {
      tabId,
      taskId,
      attachedAt: Date.now(),
      metadata
    });
    this.conflictTabs.delete(tabId);
  }

  public unregisterTabSession(tabId: number): void {
    this.activeSessions.delete(tabId);
    this.conflictTabs.delete(tabId);
  }

  public getSession(tabId: number): TabSessionInfo | null {
    return this.activeSessions.get(tabId) || null;
  }

  public isConflictActive(tabId: number): boolean {
    return this.conflictTabs.has(tabId);
  }

  /**
   * Checks whether a raw error message or exception represents a CDP debugger conflict
   */
  public isDebuggerConflictError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof BrowserError && err.code === BrowserErrorCode.DEBUGGER_CONFLICT) {
      return true;
    }
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return DEBUGGER_CONFLICT_PATTERNS.some(pat => msg.includes(pat));
  }

  /**
   * Handles CDP `Inspector.detached` event from Chrome / DevTools Protocol
   */
  public handleDetachEvent(tabId: number, reason: string): DebuggerConflictResult {
    const timestamp = Date.now();
    this.conflictTabs.add(tabId);

    const session = this.activeSessions.get(tabId);
    const taskId = session?.taskId || TabLockManager.getLockedTabOwner(tabId) || undefined;

    const conflictMessage = reason === "replaced_with_devtools"
      ? `Another debugger (e.g. Chrome DevTools) attached to tab ${tabId}, disconnecting the automated runtime.`
      : `Debugger detached from tab ${tabId}: ${reason}`;

    const conflictError = new BrowserError(
      BrowserErrorCode.DEBUGGER_CONFLICT,
      conflictMessage,
      { tabId, taskId, detachReason: reason, timestamp },
      true // Debugger conflict is retryable once DevTools is closed
    );

    // 1. Release tab lock cleanly
    let released = false;
    if (taskId) {
      released = releaseTabLock(tabId, taskId);
    }

    // 2. Clean up task approvals & transition task state if taskId is bound
    if (taskId) {
      cancelPendingApprovalsForTask(taskId);

      const task = getTaskContext(taskId);
      if (task && task.state !== TaskState.STOPPED && task.state !== TaskState.ERROR) {
        if (task.state === TaskState.CONNECTED) {
          transitionTaskState(taskId, TaskState.IDLE, "Debugger conflict");
        }
        transitionTaskState(taskId, TaskState.ERROR, `Debugger conflict on tab ${tabId}: ${reason}`);
      }
    }

    // 3. Audit log the conflict event
    recordActionAudit({
      taskId: taskId || "unknown_task",
      tabId,
      actionId: `action_cdp_conflict_${timestamp}`,
      origin: "runtime://cdp-debugger",
      actionType: "debugger_conflict_detached",
      policyTier: PermissionTier.READ,
      policyDecision: "ALLOW",
      executionResult: { tabId, detachReason: reason, releasedLock: released },
      error: conflictError.toJSON()
    });

    // 4. Notify subscribers
    const event: DebuggerConflictEvent = {
      tabId,
      taskId,
      reason,
      timestamp,
      error: conflictError
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {}
    }

    return {
      tabId,
      taskId,
      conflictDetected: true,
      reason,
      error: conflictError,
      releasedLock: released,
      timestamp
    };
  }

  /**
   * Catches runtime CDP attachment/dispatch errors and performs clean resource release
   */
  public handleDebuggerError(err: unknown, tabId?: number, taskId?: string): BrowserError {
    const timestamp = Date.now();
    const rawMsg = err instanceof Error ? err.message : String(err);
    const resolvedTabId = tabId ?? 0;
    const session = tabId ? this.activeSessions.get(tabId) : null;
    const resolvedTaskId = taskId || session?.taskId || (tabId ? TabLockManager.getLockedTabOwner(tabId) || undefined : undefined);

    if (tabId) {
      this.conflictTabs.add(tabId);
      if (resolvedTaskId) {
        releaseTabLock(tabId, resolvedTaskId);
      }
    }

    if (resolvedTaskId) {
      cancelPendingApprovalsForTask(resolvedTaskId);
      const task = getTaskContext(resolvedTaskId);
      if (task && task.state !== TaskState.STOPPED && task.state !== TaskState.ERROR) {
        if (task.state === TaskState.CONNECTED) {
          transitionTaskState(resolvedTaskId, TaskState.IDLE, "Debugger error");
        }
        transitionTaskState(resolvedTaskId, TaskState.ERROR, `Debugger conflict: ${rawMsg}`);
      }
    }

    const error = new BrowserError(
      BrowserErrorCode.DEBUGGER_CONFLICT,
      `CDP Debugger conflict detected: ${rawMsg}`,
      { tabId: resolvedTabId, taskId: resolvedTaskId, rawError: rawMsg, timestamp },
      true
    );

    recordActionAudit({
      taskId: resolvedTaskId || "unknown_task",
      tabId: resolvedTabId,
      actionId: `action_cdp_err_${timestamp}`,
      origin: "runtime://cdp-debugger",
      actionType: "debugger_conflict_error",
      policyTier: PermissionTier.READ,
      policyDecision: "ALLOW",
      error: error.toJSON()
    });

    return error;
  }

  public subscribe(listener: (event: DebuggerConflictEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const DebuggerConflictManager = new DebuggerConflictController();

export function registerTabDebuggerSession(tabId: number, taskId: string, metadata?: Record<string, any>): void {
  DebuggerConflictManager.registerTabSession(tabId, taskId, metadata);
}

export function unregisterTabDebuggerSession(tabId: number): void {
  DebuggerConflictManager.unregisterTabSession(tabId);
}

export function handleCDPDetachEvent(tabId: number, reason: string): DebuggerConflictResult {
  return DebuggerConflictManager.handleDetachEvent(tabId, reason);
}

export function handleCDPDebuggerError(err: unknown, tabId?: number, taskId?: string): BrowserError {
  return DebuggerConflictManager.handleDebuggerError(err, tabId, taskId);
}

export function isDebuggerConflict(err: unknown): boolean {
  return DebuggerConflictManager.isDebuggerConflictError(err);
}
