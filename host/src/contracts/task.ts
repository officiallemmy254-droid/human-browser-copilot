// Canonical Task State Machine & Concurrency Types (M13, M14)

export const TaskState = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTED: "CONNECTED",
  IDLE: "IDLE",
  OBSERVING: "OBSERVING",
  EXECUTING: "EXECUTING",
  WAITING: "WAITING",
  PAUSED: "PAUSED",
  HUMAN_REQUIRED: "HUMAN_REQUIRED",
  STOPPING: "STOPPING",
  STOPPED: "STOPPED",
  ERROR: "ERROR"
} as const;

export type TaskStateType = typeof TaskState[keyof typeof TaskState];

export const VALID_TASK_TRANSITIONS: Record<TaskStateType, TaskStateType[]> = {
  DISCONNECTED: [TaskState.CONNECTED, TaskState.ERROR],
  CONNECTED: [TaskState.IDLE, TaskState.DISCONNECTED, TaskState.ERROR],
  IDLE: [TaskState.OBSERVING, TaskState.EXECUTING, TaskState.WAITING, TaskState.STOPPING, TaskState.DISCONNECTED],
  OBSERVING: [TaskState.IDLE, TaskState.PAUSED, TaskState.HUMAN_REQUIRED, TaskState.STOPPING, TaskState.ERROR],
  EXECUTING: [TaskState.IDLE, TaskState.WAITING, TaskState.PAUSED, TaskState.HUMAN_REQUIRED, TaskState.STOPPING, TaskState.ERROR],
  WAITING: [TaskState.IDLE, TaskState.EXECUTING, TaskState.PAUSED, TaskState.HUMAN_REQUIRED, TaskState.STOPPING, TaskState.ERROR],
  PAUSED: [TaskState.IDLE, TaskState.EXECUTING, TaskState.STOPPING, TaskState.ERROR],
  HUMAN_REQUIRED: [TaskState.IDLE, TaskState.PAUSED, TaskState.STOPPING, TaskState.ERROR],
  STOPPING: [TaskState.STOPPED, TaskState.ERROR],
  STOPPED: [TaskState.IDLE, TaskState.DISCONNECTED],
  ERROR: [TaskState.IDLE, TaskState.DISCONNECTED]
};

export function isValidTaskTransition(fromState: TaskStateType, toState: TaskStateType): boolean {
  if (fromState === toState) return true;
  const allowed = VALID_TASK_TRANSITIONS[fromState];
  return allowed ? allowed.includes(toState) : false;
}
