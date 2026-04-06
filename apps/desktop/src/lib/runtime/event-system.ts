/**
 * Event System — Pub/Sub Event Bus for Inter-Module Communication
 * Ported from: aden-hive-hive/core/framework/runtime/event_bus.py
 *
 * Provides a typed, async-friendly event bus with:
 * - Type-based subscriptions with optional stream/node/execution filters
 * - Bounded event history for debugging
 * - Convenience emitters for common lifecycle events
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export enum EventType {
  // Execution lifecycle
  ExecutionStarted = "execution_started",
  ExecutionCompleted = "execution_completed",
  ExecutionFailed = "execution_failed",
  ExecutionPaused = "execution_paused",
  ExecutionResumed = "execution_resumed",

  // State changes
  StateChanged = "state_changed",
  StateConflict = "state_conflict",

  // Goal tracking
  GoalProgress = "goal_progress",
  GoalAchieved = "goal_achieved",
  ConstraintViolation = "constraint_violation",

  // Stream lifecycle
  StreamStarted = "stream_started",
  StreamStopped = "stream_stopped",

  // Tool lifecycle
  ToolCallStarted = "tool_call_started",
  ToolCallCompleted = "tool_call_completed",

  // Node lifecycle
  NodeLoopStarted = "node_loop_started",
  NodeLoopIteration = "node_loop_iteration",
  NodeLoopCompleted = "node_loop_completed",

  // Context
  ContextCompacted = "context_compacted",

  // Custom
  Custom = "custom",
}

// ---------------------------------------------------------------------------
// Event and subscription types
// ---------------------------------------------------------------------------

export interface AgentEvent {
  type: EventType;
  streamId: string;
  nodeId?: string;
  executionId?: string;
  graphId?: string;
  correlationId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;

export interface Subscription {
  id: string;
  eventTypes: Set<EventType>;
  handler: EventHandler;
  filterStream?: string;
  filterNode?: string;
  filterExecution?: string;
  filterGraph?: string;
}

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private subscriptions = new Map<string, Subscription>();
  private history: AgentEvent[] = [];
  private maxHistory: number;
  private subCounter = 0;
  private concurrencyLimit: number;
  private activeHandlers = 0;

  constructor(options?: { maxHistory?: number; maxConcurrentHandlers?: number }) {
    this.maxHistory = options?.maxHistory ?? 1000;
    this.concurrencyLimit = options?.maxConcurrentHandlers ?? 10;
  }

  // -----------------------------------------------------------------------
  // Subscribe / unsubscribe
  // -----------------------------------------------------------------------

  subscribe(input: {
    eventTypes: EventType[];
    handler: EventHandler;
    filterStream?: string;
    filterNode?: string;
    filterExecution?: string;
    filterGraph?: string;
  }): string {
    this.subCounter += 1;
    const id = `sub_${this.subCounter}`;
    this.subscriptions.set(id, {
      id,
      eventTypes: new Set(input.eventTypes),
      handler: input.handler,
      filterStream: input.filterStream,
      filterNode: input.filterNode,
      filterExecution: input.filterExecution,
      filterGraph: input.filterGraph,
    });
    return id;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  async publish(event: AgentEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const handlers: EventHandler[] = [];
    for (const sub of this.subscriptions.values()) {
      if (this.matches(sub, event)) handlers.push(sub.handler);
    }

    const tasks = handlers.map(h => this.runHandler(h, event));
    await Promise.allSettled(tasks);
  }

  // -----------------------------------------------------------------------
  // Convenience emitters
  // -----------------------------------------------------------------------

  async emitExecutionStarted(streamId: string, executionId: string, input?: Record<string, unknown>): Promise<void> {
    await this.publish(this.makeEvent(EventType.ExecutionStarted, streamId, { executionId, data: { input: input ?? {} } }));
  }

  async emitExecutionCompleted(streamId: string, executionId: string, output?: Record<string, unknown>): Promise<void> {
    await this.publish(this.makeEvent(EventType.ExecutionCompleted, streamId, { executionId, data: { output: output ?? {} } }));
  }

  async emitExecutionFailed(streamId: string, executionId: string, error: string): Promise<void> {
    await this.publish(this.makeEvent(EventType.ExecutionFailed, streamId, { executionId, data: { error } }));
  }

  async emitToolCallStarted(streamId: string, nodeId: string, toolName: string, toolInput?: Record<string, unknown>): Promise<void> {
    await this.publish(this.makeEvent(EventType.ToolCallStarted, streamId, { nodeId, data: { tool_name: toolName, tool_input: toolInput ?? {} } }));
  }

  async emitToolCallCompleted(streamId: string, nodeId: string, toolName: string, result: string, isError = false): Promise<void> {
    await this.publish(this.makeEvent(EventType.ToolCallCompleted, streamId, { nodeId, data: { tool_name: toolName, result, is_error: isError } }));
  }

  async emitGoalProgress(streamId: string, progress: number, criteriaStatus: Record<string, unknown>): Promise<void> {
    await this.publish(this.makeEvent(EventType.GoalProgress, streamId, { data: { progress, criteria_status: criteriaStatus } }));
  }

  async emitConstraintViolation(streamId: string, executionId: string, constraintId: string, description: string): Promise<void> {
    await this.publish(this.makeEvent(EventType.ConstraintViolation, streamId, { executionId, data: { constraint_id: constraintId, description } }));
  }

  async emitStateChanged(streamId: string, executionId: string, key: string, oldValue: unknown, newValue: unknown, scope: string): Promise<void> {
    await this.publish(this.makeEvent(EventType.StateChanged, streamId, { executionId, data: { key, old_value: oldValue, new_value: newValue, scope } }));
  }

  async emitCustom(streamId: string, data: Record<string, unknown>): Promise<void> {
    await this.publish(this.makeEvent(EventType.Custom, streamId, { data }));
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getHistory(filter?: {
    eventType?: EventType;
    streamId?: string;
    executionId?: string;
    limit?: number;
  }): AgentEvent[] {
    let events = [...this.history].reverse();
    if (filter?.eventType) events = events.filter(e => e.type === filter.eventType);
    if (filter?.streamId) events = events.filter(e => e.streamId === filter.streamId);
    if (filter?.executionId) events = events.filter(e => e.executionId === filter.executionId);
    return events.slice(0, filter?.limit ?? 100);
  }

  getStats(): { totalEvents: number; subscriptions: number; eventsByType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.history) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return { totalEvents: this.history.length, subscriptions: this.subscriptions.size, eventsByType: byType };
  }

  // -----------------------------------------------------------------------
  // Wait for a specific event
  // -----------------------------------------------------------------------

  waitFor(eventType: EventType, options?: {
    streamId?: string;
    nodeId?: string;
    executionId?: string;
    timeoutMs?: number;
  }): Promise<AgentEvent | null> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const subId = this.subscribe({
        eventTypes: [eventType],
        handler: (event) => {
          this.unsubscribe(subId);
          if (timer) clearTimeout(timer);
          resolve(event);
        },
        filterStream: options?.streamId,
        filterNode: options?.nodeId,
        filterExecution: options?.executionId,
      });

      if (options?.timeoutMs) {
        timer = setTimeout(() => {
          this.unsubscribe(subId);
          resolve(null);
        }, options.timeoutMs);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this.subscriptions.clear();
    this.history = [];
    this.subCounter = 0;
    this.activeHandlers = 0;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private matches(sub: Subscription, event: AgentEvent): boolean {
    if (!sub.eventTypes.has(event.type)) return false;
    if (sub.filterStream && sub.filterStream !== event.streamId) return false;
    if (sub.filterNode && sub.filterNode !== event.nodeId) return false;
    if (sub.filterExecution && sub.filterExecution !== event.executionId) return false;
    if (sub.filterGraph && sub.filterGraph !== event.graphId) return false;
    return true;
  }

  private async runHandler(handler: EventHandler, event: AgentEvent): Promise<void> {
    if (this.activeHandlers >= this.concurrencyLimit) return;
    this.activeHandlers += 1;
    try {
      await handler(event);
    } catch {
      // handler errors are swallowed to prevent breaking event delivery
    } finally {
      this.activeHandlers -= 1;
    }
  }

  private makeEvent(
    type: EventType,
    streamId: string,
    overrides?: Partial<Omit<AgentEvent, "type" | "streamId" | "timestamp">>,
  ): AgentEvent {
    return {
      type,
      streamId,
      data: {},
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultBus: EventBus | null = null;

export function getDefaultEventBus(): EventBus {
  if (!defaultBus) defaultBus = new EventBus();
  return defaultBus;
}

export function resetDefaultEventBus(): void {
  defaultBus?.reset();
  defaultBus = null;
}
