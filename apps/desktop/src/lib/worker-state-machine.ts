/**
 * Worker State Machine + Stale Detection
 *
 * Inspired by instructkr/claude-code's worker lifecycle pattern:
 * Explicit states with transitions, each state change emits a canonical event.
 * Stale detection fires when a worker/tool is "running" but has no progress
 * for N seconds — prevents silent hangs by showing "still waiting..." in UI.
 *
 * Core states:
 *   idle → spawning → thinking → tool_running → waiting_approval → completed|failed
 *
 * Each worker has:
 *   - Current state + timestamp entered that state
 *   - Current tool (if tool_running)
 *   - Stale timer (fires every 10s if no progress)
 */

import { emitAgentEvent } from "./event-bus";
import i18n from "../i18n";

/**
 * Optional callback: called whenever a stale event fires.
 * ChatPage can register this to show "still waiting..." in the conversation.
 */
type StaleNotifier = (msg: string) => void;
let staleNotifier: StaleNotifier | null = null;
export function setStaleNotifier(fn: StaleNotifier | null): void {
  staleNotifier = fn;
}

export type WorkerState =
  | "idle"
  | "spawning"          // Worker just activated, prompt being sent
  | "thinking"          // LLM is generating response
  | "tool_running"      // Tool is executing
  | "waiting_approval"  // Waiting for user permission
  | "completed"         // Task done successfully
  | "failed";           // Task failed

export interface WorkerStateEntry {
  workerId: string;
  workerName: string;
  state: WorkerState;
  enteredAt: number;
  currentTool?: string;
  lastProgressAt: number;
  staleNotifiedCount: number;
}

const STALE_THRESHOLD_MS = 10_000;  // 10 seconds without progress = stale
const STALE_CHECK_INTERVAL_MS = 3_000;  // Check every 3 seconds

const states = new Map<string, WorkerStateEntry>();
let staleCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start monitoring for stale workers. Should be called once on app start.
 */
export function startStaleDetection(): void {
  if (staleCheckTimer) return;
  staleCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const entry of states.values()) {
      // Only check states that could be stale
      if (!["thinking", "tool_running", "spawning"].includes(entry.state)) continue;

      const idle = now - entry.lastProgressAt;
      if (idle < STALE_THRESHOLD_MS) continue;

      // Emit stale event — UI can show "still waiting..."
      const elapsedSec = Math.floor((now - entry.enteredAt) / 1000);
      entry.staleNotifiedCount++;

      emitAgentEvent({
        type: "worker_stale",
        workerId: entry.workerId,
        worker: entry.workerName,
        state: entry.state,
        currentTool: entry.currentTool,
        elapsedSec,
        notifyCount: entry.staleNotifiedCount,
      });

      // Also push a user-visible stale message
      if (staleNotifier) {
        const isZh = i18n.language.startsWith("zh");
        const stateLabel = formatStateLabel(entry.state, isZh);
        const toolInfo = entry.currentTool ? ` (${entry.currentTool})` : "";
        const msg = isZh
          ? `⏳ ${entry.workerName} 仍在${stateLabel}${toolInfo}... 已用时 ${elapsedSec}s`
          : `⏳ ${entry.workerName} still ${stateLabel}${toolInfo}... ${elapsedSec}s elapsed`;
        try { staleNotifier(msg); } catch { /* swallow */ }
      }

      // Reset the clock so we don't spam — next notification in another 10s
      entry.lastProgressAt = now;
    }
  }, STALE_CHECK_INTERVAL_MS);
}

function formatStateLabel(state: WorkerState, isZh: boolean): string {
  const labels: Record<WorkerState, { zh: string; en: string }> = {
    idle: { zh: "空闲", en: "idle" },
    spawning: { zh: "初始化", en: "initializing" },
    thinking: { zh: "思考", en: "thinking" },
    tool_running: { zh: "执行工具", en: "running tool" },
    waiting_approval: { zh: "等待授权", en: "awaiting approval" },
    completed: { zh: "完成", en: "completed" },
    failed: { zh: "失败", en: "failed" },
  };
  return isZh ? labels[state].zh : labels[state].en;
}

export function stopStaleDetection(): void {
  if (staleCheckTimer) {
    clearInterval(staleCheckTimer);
    staleCheckTimer = null;
  }
}

/**
 * Transition a worker to a new state. Emits canonical event.
 */
export function transitionWorker(
  workerId: string,
  workerName: string,
  newState: WorkerState,
  meta?: { currentTool?: string; error?: string },
): void {
  const now = Date.now();
  const prev = states.get(workerId);
  const prevState = prev?.state ?? "idle";

  const entry: WorkerStateEntry = {
    workerId,
    workerName,
    state: newState,
    enteredAt: now,
    currentTool: meta?.currentTool,
    lastProgressAt: now,
    staleNotifiedCount: 0,
  };
  states.set(workerId, entry);

  // Emit canonical transition event
  emitAgentEvent({
    type: "worker_state_transition",
    workerId,
    worker: workerName,
    fromState: prevState,
    toState: newState,
    currentTool: meta?.currentTool,
    error: meta?.error,
    elapsedMs: prev ? now - prev.enteredAt : 0,
  });

  // Clean up terminal states after 30s (for UI animation)
  if (newState === "completed" || newState === "failed") {
    setTimeout(() => {
      const current = states.get(workerId);
      if (current && (current.state === "completed" || current.state === "failed")) {
        states.delete(workerId);
      }
    }, 30_000);
  }
}

/**
 * Mark progress (reset stale timer). Call when anything happens:
 * - LLM emits text/thinking/tool_use
 * - Tool reports intermediate progress
 */
export function reportProgress(workerId: string): void {
  const entry = states.get(workerId);
  if (entry) {
    entry.lastProgressAt = Date.now();
    entry.staleNotifiedCount = 0; // Reset notification count
  }
}

export function getWorkerState(workerId: string): WorkerStateEntry | null {
  return states.get(workerId) ?? null;
}

export function getAllActiveStates(): WorkerStateEntry[] {
  return Array.from(states.values());
}

export function clearAllStates(): void {
  states.clear();
}

// ═══════════ Helpers for common transitions ═══════════

export function workerSpawning(workerId: string, workerName: string): void {
  transitionWorker(workerId, workerName, "spawning");
}

export function workerThinking(workerId: string, workerName: string): void {
  transitionWorker(workerId, workerName, "thinking");
}

export function workerToolRunning(workerId: string, workerName: string, toolName: string): void {
  transitionWorker(workerId, workerName, "tool_running", { currentTool: toolName });
}

export function workerWaitingApproval(workerId: string, workerName: string, toolName: string): void {
  transitionWorker(workerId, workerName, "waiting_approval", { currentTool: toolName });
}

export function workerCompleted(workerId: string, workerName: string): void {
  transitionWorker(workerId, workerName, "completed");
}

export function workerFailed(workerId: string, workerName: string, error: string): void {
  transitionWorker(workerId, workerName, "failed", { error });
}
