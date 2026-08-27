// Human Browser Runtime - Task State Machine & Lifecycle Controller (M13)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { TaskState, TaskStateType, isValidTaskTransition } from "./contracts/task.js";
import { recordActionAudit } from "./audit_logger.js";
import { PermissionTier } from "./contracts/policy.js";

export interface TaskContext {
  taskId: string;
  state: TaskStateType;
  agentId?: string;
  tabIds: number[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

export interface TransitionResult {
  success: boolean;
  task?: TaskContext;
  error?: BrowserError;
}

class TaskStateManager {
  private tasks = new Map<string, TaskContext>();
  private listeners: Array<(task: TaskContext, oldState: TaskStateType) => void> = [];

  public clear(): void {
    this.tasks.clear();
  }

  public createTask(taskId: string, metadata?: Record<string, any>): TaskContext {
    const now = Date.now();
    const task: TaskContext = {
      taskId,
      state: TaskState.CONNECTED,
      agentId: metadata?.agentId,
      tabIds: metadata?.tabIds || [],
      createdAt: now,
      updatedAt: now,
      metadata
    };

    this.tasks.set(taskId, task);
    return task;
  }

  public getTask(taskId: string): TaskContext | null {
    return this.tasks.get(taskId) || null;
  }

  public transition(taskId: string, newState: TaskStateType, reason?: string): TransitionResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Task "${taskId}" not found in state machine registry.`,
          { taskId, targetState: newState }
        )
      };
    }

    const currentState = task.state;

    // Check transition validity against formal graph
    if (!isValidTaskTransition(currentState, newState)) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Invalid state transition from "${currentState}" to "${newState}" for task "${taskId}".`,
          { taskId, currentState, targetState: newState, reason }
        )
      };
    }

    // Apply valid transition
    task.state = newState;
    task.updatedAt = Date.now();

    // Log state transition in audit trail
    recordActionAudit({
      taskId,
      actionId: `action_state_${Date.now()}`,
      origin: "runtime://state-machine",
      actionType: "task_state_transition",
      policyTier: PermissionTier.READ,
      policyDecision: "ALLOW",
      executionResult: { from: currentState, to: newState, reason }
    });

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(task, currentState);
      } catch (e) {}
    }

    return {
      success: true,
      task
    };
  }

  public subscribe(listener: (task: TaskContext, oldState: TaskStateType) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const TaskManager = new TaskStateManager();

export function createTaskContext(taskId: string, metadata?: Record<string, any>): TaskContext {
  return TaskManager.createTask(taskId, metadata);
}

export function transitionTaskState(taskId: string, newState: TaskStateType, reason?: string): TransitionResult {
  return TaskManager.transition(taskId, newState, reason);
}

export function getTaskContext(taskId: string): TaskContext | null {
  return TaskManager.getTask(taskId);
}
