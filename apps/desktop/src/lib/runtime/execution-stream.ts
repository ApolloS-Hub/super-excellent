/**
 * Execution Stream — Manages Tool Call Streaming & Execution Lifecycle
 * Ported from: aden-hive-hive/core/framework/runtime/execution_stream.py
 *
 * Each stream runs sequential executions for a single entry point.
 * Supports start/stop lifecycle, execution tracking, result retention,
 * and automatic resurrection on non-fatal failures.
 */

import { EventBus, EventType } from "./event-system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";
export type IsolationLevel = "isolated" | "shared" | "synchronized";

export interface EntryPointSpec {
  id: string;
  name: string;
  entryNode: string;
  triggerType: "webhook" | "api" | "timer" | "event" | "manual";
  triggerConfig: Record<string, unknown>;
  isolationLevel: IsolationLevel;
  priority: number;
  maxConcurrent: number;
  maxResurrections: number;
}

export interface ExecutionContext {
  id: string;
  correlationId: string;
  streamId: string;
  entryPoint: string;
  inputData: Record<string, unknown>;
  isolationLevel: IsolationLevel;
  startedAt: string;
  completedAt?: string;
  status: ExecutionStatus;
}

export interface ExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  pausedAt?: string;
}

export interface StreamStats {
  streamId: string;
  entryPoint: string;
  running: boolean;
  totalActive: number;
  totalCompleted: number;
  statusCounts: Record<ExecutionStatus, number>;
  maxConcurrent: number;
}

// ---------------------------------------------------------------------------
// Fatal error patterns — resurrection won't help
// ---------------------------------------------------------------------------

const FATAL_PATTERNS = [
  "credential", "authentication", "unauthorized", "forbidden",
  "api key", "permission denied", "configuration error",
  "node stalled", "max iterations",
];

function isFatalError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return FATAL_PATTERNS.some(p => lower.includes(p));
}

// ---------------------------------------------------------------------------
// ExecutionStream
// ---------------------------------------------------------------------------

export class ExecutionStream {
  readonly streamId: string;
  readonly entrySpec: EntryPointSpec;
  private eventBus: EventBus | null;

  private activeExecutions = new Map<string, ExecutionContext>();
  private results = new Map<string, ExecutionResult>();
  private resultTimes = new Map<string, number>();
  private running = false;
  private executionCounter = 0;
  private maxRetention: number;

  constructor(input: {
    streamId: string;
    entrySpec: EntryPointSpec;
    eventBus?: EventBus;
    resultRetentionMax?: number;
  }) {
    this.streamId = input.streamId;
    this.entrySpec = input.entrySpec;
    this.eventBus = input.eventBus ?? null;
    this.maxRetention = input.resultRetentionMax ?? 1000;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.eventBus) {
      await this.eventBus.publish({
        type: EventType.StreamStarted,
        streamId: this.streamId,
        data: { entry_point: this.entrySpec.id },
        timestamp: new Date().toISOString(),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.activeExecutions.clear();
    if (this.eventBus) {
      await this.eventBus.publish({
        type: EventType.StreamStopped,
        streamId: this.streamId,
        data: {},
        timestamp: new Date().toISOString(),
      });
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get activeExecutionIds(): string[] {
    return [...this.activeExecutions.keys()];
  }

  // -----------------------------------------------------------------------
  // Execute
  // -----------------------------------------------------------------------

  async execute(input: {
    inputData: Record<string, unknown>;
    correlationId?: string;
    executor: (ctx: ExecutionContext) => Promise<ExecutionResult>;
  }): Promise<string> {
    if (!this.running) throw new Error(`Stream '${this.streamId}' is not running`);
    if (this.activeExecutions.size >= this.entrySpec.maxConcurrent) {
      throw new Error(`Stream '${this.streamId}' is at max concurrency (${this.entrySpec.maxConcurrent})`);
    }

    this.executionCounter += 1;
    const executionId = `exec-${this.streamId}-${this.executionCounter}-${Date.now()}`;
    const correlationId = input.correlationId ?? executionId;

    const ctx: ExecutionContext = {
      id: executionId,
      correlationId,
      streamId: this.streamId,
      entryPoint: this.entrySpec.id,
      inputData: input.inputData,
      isolationLevel: this.entrySpec.isolationLevel,
      startedAt: new Date().toISOString(),
      status: "pending",
    };

    this.activeExecutions.set(executionId, ctx);

    // Run execution with resurrection support
    this.runWithResurrection(ctx, input.executor).catch(() => {
      // errors already handled inside
    });

    return executionId;
  }

  private async runWithResurrection(
    ctx: ExecutionContext,
    executor: (ctx: ExecutionContext) => Promise<ExecutionResult>,
  ): Promise<void> {
    ctx.status = "running";
    let resurrections = 0;

    if (this.eventBus) {
      await this.eventBus.emitExecutionStarted(this.streamId, ctx.id, ctx.inputData);
    }

    try {
      for (;;) {
        let result: ExecutionResult;
        try {
          result = await executor(ctx);
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : String(err) };
        }

        // Check if resurrection is appropriate
        if (
          !result.success &&
          !result.pausedAt &&
          resurrections < this.entrySpec.maxResurrections &&
          !isFatalError(result.error)
        ) {
          resurrections += 1;
          await delay(2000);
          continue;
        }

        // Record result
        this.recordResult(ctx.id, result);
        ctx.completedAt = new Date().toISOString();
        ctx.status = result.success ? "completed" : result.pausedAt ? "paused" : "failed";

        // Emit event
        if (this.eventBus) {
          if (result.success) {
            await this.eventBus.emitExecutionCompleted(this.streamId, ctx.id, result.output);
          } else {
            await this.eventBus.emitExecutionFailed(this.streamId, ctx.id, result.error ?? "Unknown error");
          }
        }

        break;
      }
    } finally {
      this.activeExecutions.delete(ctx.id);
    }
  }

  // -----------------------------------------------------------------------
  // Results
  // -----------------------------------------------------------------------

  getResult(executionId: string): ExecutionResult | undefined {
    this.pruneResults();
    return this.results.get(executionId);
  }

  getContext(executionId: string): ExecutionContext | undefined {
    return this.activeExecutions.get(executionId);
  }

  private recordResult(executionId: string, result: ExecutionResult): void {
    this.results.set(executionId, result);
    this.resultTimes.set(executionId, Date.now());
    this.pruneResults();
  }

  private pruneResults(): void {
    while (this.results.size > this.maxRetention) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
      this.resultTimes.delete(oldest);
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): StreamStats {
    const counts: Record<ExecutionStatus, number> = {
      pending: 0, running: 0, completed: 0, failed: 0, paused: 0, cancelled: 0,
    };
    for (const ctx of this.activeExecutions.values()) {
      counts[ctx.status] += 1;
    }
    return {
      streamId: this.streamId,
      entryPoint: this.entrySpec.id,
      running: this.running,
      totalActive: this.activeExecutions.size,
      totalCompleted: this.results.size,
      statusCounts: counts,
      maxConcurrent: this.entrySpec.maxConcurrent,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExecutionStream(input: {
  streamId: string;
  entryNode: string;
  triggerType?: EntryPointSpec["triggerType"];
  maxConcurrent?: number;
  maxResurrections?: number;
  eventBus?: EventBus;
}): ExecutionStream {
  return new ExecutionStream({
    streamId: input.streamId,
    entrySpec: {
      id: input.streamId,
      name: input.streamId,
      entryNode: input.entryNode,
      triggerType: input.triggerType ?? "manual",
      triggerConfig: {},
      isolationLevel: "shared",
      priority: 0,
      maxConcurrent: input.maxConcurrent ?? 10,
      maxResurrections: input.maxResurrections ?? 3,
    },
    eventBus: input.eventBus,
  });
}
