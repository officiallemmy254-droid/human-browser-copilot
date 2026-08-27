// Human Browser Runtime - Event Streamer & Topic Subscription Registry (M22)
import { AuditEvent } from "./contracts/events.js";
import { TaskStateType } from "./contracts/task.js";
import { ApprovalRequest } from "./approval_broker.js";
import { PermissionTierType } from "./contracts/policy.js";

let streamEventSequence = 1;

export function generateStreamEventId(): string {
  const idStr = String(streamEventSequence++).padStart(6, "0");
  return `sev_${idStr}`;
}

export function resetStreamEventIdSequence(): void {
  streamEventSequence = 1;
}

export interface StreamEvent<T = any> {
  id: string;
  topic: string;
  timestamp: number;
  taskId?: string;
  origin?: string;
  data: T;
}

export interface SubscriptionFilter {
  topic?: string | string[];
  taskId?: string;
  origin?: string;
  actionType?: string;
  tier?: PermissionTierType;
  predicate?: (event: StreamEvent) => boolean;
}

export interface SubscriptionHandle {
  id: string;
  filter: SubscriptionFilter;
  unsubscribe: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  isActive: () => boolean;
}

export type StreamEventListener = (event: StreamEvent) => void | Promise<void>;

interface InternalSubscriber {
  id: string;
  filter: SubscriptionFilter;
  listener: StreamEventListener;
  paused: boolean;
  active: boolean;
}

let subSequence = 1;

export function matchesTopic(eventTopic: string, filterPattern: string): boolean {
  if (filterPattern === "*" || filterPattern === "**") {
    return true;
  }

  if (filterPattern.endsWith(":*")) {
    const prefix = filterPattern.slice(0, -2);
    return eventTopic === prefix || eventTopic.startsWith(prefix + ":");
  }

  if (filterPattern.endsWith(".*")) {
    const prefix = filterPattern.slice(0, -2);
    return eventTopic === prefix || eventTopic.startsWith(prefix + ".");
  }

  return eventTopic.toLowerCase() === filterPattern.toLowerCase();
}

export class EventStreamerManager {
  private subscribers = new Map<string, InternalSubscriber>();
  private history: StreamEvent[] = [];
  private maxHistorySize: number = 200;

  constructor(maxHistory: number = 200) {
    this.maxHistorySize = maxHistory;
  }

  public setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    if (this.history.length > size) {
      this.history = this.history.slice(-size);
    }
  }

  public clear(): void {
    this.subscribers.clear();
    this.history = [];
    resetStreamEventIdSequence();
    subSequence = 1;
  }

  public clearSubscribers(): void {
    for (const sub of this.subscribers.values()) {
      sub.active = false;
    }
    this.subscribers.clear();
  }

  public clearHistory(): void {
    this.history = [];
  }

  public subscribe(
    topicOrFilter: string | SubscriptionFilter,
    listener: StreamEventListener
  ): SubscriptionHandle {
    const subId = `sub_${subSequence++}`;

    const filter: SubscriptionFilter =
      typeof topicOrFilter === "string" ? { topic: topicOrFilter } : { ...topicOrFilter };

    const subscriber: InternalSubscriber = {
      id: subId,
      filter,
      listener,
      paused: false,
      active: true
    };

    this.subscribers.set(subId, subscriber);

    const handle: SubscriptionHandle = {
      id: subId,
      filter,
      unsubscribe: () => {
        subscriber.active = false;
        this.subscribers.delete(subId);
      },
      pause: () => {
        subscriber.paused = true;
      },
      resume: () => {
        subscriber.paused = false;
      },
      isPaused: () => subscriber.paused,
      isActive: () => subscriber.active && this.subscribers.has(subId)
    };

    return handle;
  }

  public emit<T = any>(
    topic: string,
    data: T,
    metadata: { taskId?: string; origin?: string } = {}
  ): StreamEvent<T> {
    const event: StreamEvent<T> = {
      id: generateStreamEventId(),
      topic,
      timestamp: Date.now(),
      taskId: metadata.taskId,
      origin: metadata.origin,
      data
    };

    // Store in history ring buffer
    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Dispatch to matching active subscribers
    for (const sub of this.subscribers.values()) {
      if (!sub.active || sub.paused) continue;

      if (this.matchesFilter(event, sub.filter)) {
        try {
          const res = sub.listener(event);
          if (res && typeof (res as any).catch === "function") {
            (res as any).catch(() => {});
          }
        } catch (e) {
          // Prevent failing subscriber from breaking stream
        }
      }
    }

    return event;
  }

  public publishAuditEvent(auditEvent: AuditEvent): StreamEvent<AuditEvent> {
    const hasError = Boolean(auditEvent.error);
    const topic = hasError ? "audit:error" : "audit:action";

    return this.emit(topic, auditEvent, {
      taskId: auditEvent.taskId,
      origin: auditEvent.origin
    });
  }

  public publishStateTransition(
    taskId: string,
    fromState: TaskStateType,
    toState: TaskStateType,
    details?: Record<string, any>
  ): StreamEvent {
    return this.emit(
      "state:transition",
      {
        taskId,
        fromState,
        toState,
        details
      },
      { taskId }
    );
  }

  public publishApprovalEvent(
    type: "requested" | "resolved" | "timeout" | "cancelled",
    approval: ApprovalRequest
  ): StreamEvent<ApprovalRequest> {
    return this.emit(`approval:${type}`, approval, {
      taskId: approval.taskId,
      origin: approval.origin
    });
  }

  public getSubscriberCount(topicPattern?: string): number {
    if (!topicPattern) {
      return this.subscribers.size;
    }

    let count = 0;
    for (const sub of this.subscribers.values()) {
      if (!sub.active) continue;
      const topics = Array.isArray(sub.filter.topic)
        ? sub.filter.topic
        : [sub.filter.topic || "*"];

      if (topics.some(t => matchesTopic(topicPattern, t) || matchesTopic(t, topicPattern))) {
        count++;
      }
    }
    return count;
  }

  public getRecentEvents(options: { count?: number; filter?: SubscriptionFilter } = {}): StreamEvent[] {
    let filtered = this.history;

    if (options.filter) {
      filtered = filtered.filter(evt => this.matchesFilter(evt, options.filter!));
    }

    const count = options.count ?? filtered.length;
    return filtered.slice(-count);
  }

  public replay(handle: SubscriptionHandle, count?: number): number {
    const sub = this.subscribers.get(handle.id);
    if (!sub || !sub.active) return 0;

    const eventsToReplay = this.getRecentEvents({ count, filter: sub.filter });
    let replayed = 0;

    for (const event of eventsToReplay) {
      try {
        sub.listener(event);
        replayed++;
      } catch (e) {}
    }

    return replayed;
  }

  private matchesFilter(event: StreamEvent, filter: SubscriptionFilter): boolean {
    // Topic filtering
    if (filter.topic) {
      const patterns = Array.isArray(filter.topic) ? filter.topic : [filter.topic];
      const matchesAnyTopic = patterns.some(pattern => matchesTopic(event.topic, pattern));
      if (!matchesAnyTopic) return false;
    }

    // TaskId filter
    if (filter.taskId && event.taskId && event.taskId !== filter.taskId) {
      return false;
    }

    // Origin filter
    if (filter.origin && event.origin && event.origin !== filter.origin) {
      return false;
    }

    // Tier filter (from data if audit event)
    if (filter.tier && event.data && event.data.policyTier && event.data.policyTier !== filter.tier) {
      return false;
    }

    // ActionType filter
    if (filter.actionType && event.data && event.data.actionType && event.data.actionType !== filter.actionType) {
      return false;
    }

    // Predicate filter
    if (filter.predicate && !filter.predicate(event)) {
      return false;
    }

    return true;
  }
}

export const EventStreamer = new EventStreamerManager();
