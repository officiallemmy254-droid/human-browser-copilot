import { describe, it, expect } from "vitest";
import { TaskState, isValidTaskTransition } from "../../src/contracts/task.js";

describe("M13: Task State Machine Transitions", () => {
  it("should allow legal transitions", () => {
    expect(isValidTaskTransition(TaskState.DISCONNECTED, TaskState.CONNECTED)).toBe(true);
    expect(isValidTaskTransition(TaskState.CONNECTED, TaskState.IDLE)).toBe(true);
    expect(isValidTaskTransition(TaskState.IDLE, TaskState.EXECUTING)).toBe(true);
    expect(isValidTaskTransition(TaskState.EXECUTING, TaskState.PAUSED)).toBe(true);
    expect(isValidTaskTransition(TaskState.PAUSED, TaskState.EXECUTING)).toBe(true);
    expect(isValidTaskTransition(TaskState.EXECUTING, TaskState.IDLE)).toBe(true);
    expect(isValidTaskTransition(TaskState.IDLE, TaskState.STOPPING)).toBe(true);
    expect(isValidTaskTransition(TaskState.STOPPING, TaskState.STOPPED)).toBe(true);
  });

  it("should reject illegal transitions", () => {
    // Cannot jump from IDLE directly to STOPPED without entering STOPPING
    expect(isValidTaskTransition(TaskState.IDLE, TaskState.STOPPED)).toBe(false);
    // Cannot jump from STOPPED directly to EXECUTING
    expect(isValidTaskTransition(TaskState.STOPPED, TaskState.EXECUTING)).toBe(false);
    // Cannot transition from DISCONNECTED to EXECUTING
    expect(isValidTaskTransition(TaskState.DISCONNECTED, TaskState.EXECUTING)).toBe(false);
  });
});
