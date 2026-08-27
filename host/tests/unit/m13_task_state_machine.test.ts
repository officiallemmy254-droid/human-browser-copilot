import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { TaskState } from "../../src/contracts/task.js";
import {
  TaskManager,
  createTaskContext,
  transitionTaskState,
  getTaskContext
} from "../../src/task_state_machine.js";

describe("M13: Task State Machine & Lifecycle Transitions", () => {
  beforeEach(() => {
    TaskManager.clear();
  });

  it("should create a task in CONNECTED state and transition to IDLE", () => {
    const task = createTaskContext("task_1", { agentId: "codex-agent" });
    expect(task.state).toBe(TaskState.CONNECTED);

    const transitioned = transitionTaskState("task_1", TaskState.IDLE);
    expect(transitioned.success).toBe(true);
    expect(transitioned.task?.state).toBe(TaskState.IDLE);
  });

  it("should follow valid execution lifecycle transitions", () => {
    createTaskContext("task_2");
    transitionTaskState("task_2", TaskState.IDLE);
    transitionTaskState("task_2", TaskState.OBSERVING);
    transitionTaskState("task_2", TaskState.EXECUTING);
    transitionTaskState("task_2", TaskState.WAITING);
    transitionTaskState("task_2", TaskState.IDLE);
    transitionTaskState("task_2", TaskState.STOPPING);
    const finalState = transitionTaskState("task_2", TaskState.STOPPED);

    expect(finalState.success).toBe(true);
    expect(finalState.task?.state).toBe(TaskState.STOPPED);
  });

  it("should reject invalid state transitions with typed INVALID_STATE error", () => {
    createTaskContext("task_3"); // Starts in CONNECTED
    // Attempting to jump directly from CONNECTED to EXECUTING is invalid
    const result = transitionTaskState("task_3", TaskState.EXECUTING);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(BrowserErrorCode.INVALID_STATE);
    expect(result.error?.message).toContain("Invalid state transition from \"CONNECTED\" to \"EXECUTING\"");

    // Verify task state remains unchanged
    expect(getTaskContext("task_3")?.state).toBe(TaskState.CONNECTED);
  });

  it("should support PAUSED and RESUMED transitions", () => {
    createTaskContext("task_4");
    transitionTaskState("task_4", TaskState.IDLE);
    transitionTaskState("task_4", TaskState.EXECUTING);

    // Pause
    const pauseRes = transitionTaskState("task_4", TaskState.PAUSED);
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.task?.state).toBe(TaskState.PAUSED);

    // Resume to IDLE
    const resumeRes = transitionTaskState("task_4", TaskState.IDLE);
    expect(resumeRes.success).toBe(true);
    expect(resumeRes.task?.state).toBe(TaskState.IDLE);
  });

  it("should support HUMAN_REQUIRED handoff state", () => {
    createTaskContext("task_5");
    transitionTaskState("task_5", TaskState.IDLE);
    transitionTaskState("task_5", TaskState.EXECUTING);

    // Handoff to human for CAPTCHA / 2FA
    const handoffRes = transitionTaskState("task_5", TaskState.HUMAN_REQUIRED);
    expect(handoffRes.success).toBe(true);
    expect(handoffRes.task?.state).toBe(TaskState.HUMAN_REQUIRED);

    // Return to IDLE after human completes
    const returnRes = transitionTaskState("task_5", TaskState.IDLE);
    expect(returnRes.success).toBe(true);
  });
});
