// Human Browser Runtime - Emergency Stop & Circuit Breaker Controller (M17)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { TaskState, TaskStateType } from "./contracts/task.js";
import { TaskManager, transitionTaskState, getTaskContext } from "./task_state_machine.js";
import { cancelPendingApprovalsForTask, ApprovalBroker } from "./approval_broker.js";
import { releaseAllLocksForTask } from "./tab_lock_manager.js";
import { recordActionAudit } from "./audit_logger.js";
import { PermissionTier } from "./contracts/policy.js";

export interface ActionQueue {
  purge: () => number;
}

export type CommandCancelCallback = (error: BrowserError) => void;

export interface EmergencyStopResult {
  taskId: string;
  success: boolean;
  finalState: TaskStateType;
  cancelledApprovalsCount: number;
  releasedLocksCount: number;
  purgedQueuedActionsCount: number;
  abortedActiveCommandsCount: number;
  reason: string;
  timestamp: number;
  error?: BrowserError;
}

export interface EmergencyStopEvent {
  taskId: string;
  reason: string;
  timestamp: number;
  result: EmergencyStopResult;
}

class EmergencyStopController {
  private abortControllers = new Map<string, Set<AbortController>>();
  private activeCommandCallbacks = new Map<string, Set<CommandCancelCallback>>();
  private actionQueues = new Map<string, Set<ActionQueue>>();
  private listeners: Array<(event: EmergencyStopEvent) => void> = [];

  public clear(): void {
    this.abortControllers.clear();
    this.activeCommandCallbacks.clear();
    this.actionQueues.clear();
  }

  /**
   * Registers an AbortController for a running task to receive instant abort signal on emergency stop
   */
  public registerAbortController(taskId: string, controller: AbortController): () => void {
    if (!this.abortControllers.has(taskId)) {
      this.abortControllers.set(taskId, new Set());
    }
    this.abortControllers.get(taskId)!.add(controller);

    return () => {
      const set = this.abortControllers.get(taskId);
      if (set) {
        set.delete(controller);
        if (set.size === 0) this.abortControllers.delete(taskId);
      }
    };
  }

  /**
   * Registers an in-flight command cancellation callback
   */
  public registerActiveCommand(taskId: string, callback: CommandCancelCallback): () => void {
    if (!this.activeCommandCallbacks.has(taskId)) {
      this.activeCommandCallbacks.set(taskId, new Set());
    }
    this.activeCommandCallbacks.get(taskId)!.add(callback);

    return () => {
      const set = this.activeCommandCallbacks.get(taskId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.activeCommandCallbacks.delete(taskId);
      }
    };
  }

  /**
   * Registers an action queue for a task to be purged on emergency stop
   */
  public registerActionQueue(taskId: string, queue: ActionQueue): () => void {
    if (!this.actionQueues.has(taskId)) {
      this.actionQueues.set(taskId, new Set());
    }
    this.actionQueues.get(taskId)!.add(queue);

    return () => {
      const set = this.actionQueues.get(taskId);
      if (set) {
        set.delete(queue);
        if (set.size === 0) this.actionQueues.delete(taskId);
      }
    };
  }

  public isEmergencyStopped(taskId: string): boolean {
    const context = getTaskContext(taskId);
    return context ? (context.state === TaskState.STOPPING || context.state === TaskState.STOPPED) : false;
  }

  /**
   * Triggers an immediate emergency stop for a task:
   * 1. Cancels all pending approvals
   * 2. Purges queued actions
   * 3. Aborts in-flight browser commands with TASK_CANCELLED
   * 4. Releases all tab locks held by task
   * 5. Transitions task state: STOPPING -> STOPPED
   */
  public triggerEmergencyStop(taskId: string, reason: string = "Emergency stop initiated by user or safety policy"): EmergencyStopResult {
    const timestamp = Date.now();
    const task = getTaskContext(taskId);

    const cancelError = new BrowserError(
      BrowserErrorCode.TASK_CANCELLED,
      `Task "${taskId}" was terminated immediately by emergency stop: ${reason}`,
      { taskId, reason, timestamp },
      false
    );

    // 1. Cancel pending approvals in ApprovalBroker
    const pendingApprovalsBefore = ApprovalBroker.getPendingApprovals(taskId).length;
    cancelPendingApprovalsForTask(taskId);

    // 2. Abort registered AbortControllers
    let abortedCount = 0;
    const controllers = this.abortControllers.get(taskId);
    if (controllers) {
      for (const ctrl of controllers) {
        try {
          ctrl.abort(cancelError);
          abortedCount++;
        } catch (e) {}
      }
      this.abortControllers.delete(taskId);
    }

    // 3. Invoke active command cancellation callbacks
    const callbacks = this.activeCommandCallbacks.get(taskId);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(cancelError);
          abortedCount++;
        } catch (e) {}
      }
      this.activeCommandCallbacks.delete(taskId);
    }

    // 4. Purge queued actions in registered action queues
    let purgedCount = 0;
    const queues = this.actionQueues.get(taskId);
    if (queues) {
      for (const q of queues) {
        try {
          purgedCount += q.purge();
        } catch (e) {}
      }
      this.actionQueues.delete(taskId);
    }

    // 5. Release all tab locks held by the task
    const releasedLocks = releaseAllLocksForTask(taskId);

    // 6. Transition Task State Machine to STOPPING -> STOPPED
    let finalState: TaskStateType = task ? task.state : TaskState.STOPPED;

    if (task) {
      if (task.state === TaskState.CONNECTED) {
        transitionTaskState(taskId, TaskState.IDLE, reason);
      }
      if (task.state !== TaskState.STOPPED && task.state !== TaskState.STOPPING) {
        transitionTaskState(taskId, TaskState.STOPPING, reason);
      }
      const stopTransition = transitionTaskState(taskId, TaskState.STOPPED, reason);
      finalState = stopTransition.task ? stopTransition.task.state : TaskState.STOPPED;
    }

    const result: EmergencyStopResult = {
      taskId,
      success: true,
      finalState,
      cancelledApprovalsCount: pendingApprovalsBefore,
      releasedLocksCount: releasedLocks,
      purgedQueuedActionsCount: purgedCount,
      abortedActiveCommandsCount: abortedCount,
      reason,
      timestamp
    };

    // 7. Audit log the emergency stop event
    recordActionAudit({
      taskId,
      actionId: `action_estop_${timestamp}`,
      origin: "runtime://emergency-stop",
      actionType: "emergency_stop_triggered",
      policyTier: PermissionTier.HIGH_RISK,
      policyDecision: "ALLOW",
      executionResult: result,
      error: cancelError.toJSON()
    });

    // 8. Notify subscribers
    const event: EmergencyStopEvent = {
      taskId,
      reason,
      timestamp,
      result
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {}
    }

    return result;
  }

  public subscribe(listener: (event: EmergencyStopEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const EmergencyStop = new EmergencyStopController();

export function triggerEmergencyStop(taskId: string, reason?: string): EmergencyStopResult {
  return EmergencyStop.triggerEmergencyStop(taskId, reason);
}

export function registerTaskAbortController(taskId: string, controller: AbortController): () => void {
  return EmergencyStop.registerAbortController(taskId, controller);
}

export function registerTaskActiveCommand(taskId: string, callback: CommandCancelCallback): () => void {
  return EmergencyStop.registerActiveCommand(taskId, callback);
}

export function registerTaskActionQueue(taskId: string, queue: ActionQueue): () => void {
  return EmergencyStop.registerActionQueue(taskId, queue);
}

export function isEmergencyStopped(taskId: string): boolean {
  return EmergencyStop.isEmergencyStopped(taskId);
}
