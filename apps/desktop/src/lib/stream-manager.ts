/**
 * Stream Manager — global singleton that manages LLM streaming sessions
 * independently of React component lifecycle.
 *
 * Inspired by CodePilot's StreamSessionManager pattern:
 * - Each session has its own state (accumulatedText, toolCalls, status)
 * - Switching conversations doesn't kill the active stream
 * - New ChatView subscribes to current session's snapshot to recover state
 * - Idle timeout (330s) auto-aborts stuck streams
 *
 * Uses globalThis pattern to survive HMR without losing state.
 */

import type { AgentEvent, AgentConfig } from "./agent-bridge";

// ==========================================
// Types
// ==========================================

export interface ToolCallInfo {
  name: string;
  input: string;
  output?: string;
  status: "running" | "success" | "error";
}

export type StreamStatus = "idle" | "active" | "paused" | "completed" | "error" | "stopped";

export interface StreamSnapshot {
  sessionId: string;
  status: StreamStatus;
  accumulatedText: string;
  toolCalls: ToolCallInfo[];
  isThinking: boolean;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export type StreamEventType = "snapshot-updated" | "completed" | "error";

export interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  snapshot: StreamSnapshot;
}

export type StreamEventListener = (event: StreamEvent) => void;

interface SessionStream {
  sessionId: string;
  abortController: AbortController;
  snapshot: StreamSnapshot;
  accumulatedText: string;
  toolCalls: ToolCallInfo[];
  isThinking: boolean;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number;
  gcTimer: ReturnType<typeof setTimeout> | null;
  /** Saved context for resume after pause */
  pausedContext: {
    message: string;
    config: AgentConfig;
    history: Array<{ role: string; content: string }>;
    partialText: string;
  } | null;
}

export interface StartStreamParams {
  sessionId: string;
  message: string;
  config: AgentConfig;
  history?: Array<{ role: string; content: string }>;
}

/** Signature matching agent-bridge.sendMessage */
export type ApiCallFn = (
  message: string,
  config: AgentConfig,
  onEvent: (event: AgentEvent) => void,
  history?: Array<{ role: string; content: string }>,
) => Promise<void>;

// ==========================================
// Singleton via globalThis
// ==========================================

const GLOBAL_KEY = "__superExcellentStreamManager__" as const;
const LISTENERS_KEY = "__superExcellentStreamListeners__" as const;
const STREAM_IDLE_TIMEOUT_MS = 330_000;
const GC_DELAY_MS = 5 * 60 * 1000;

function getStreamsMap(): Map<string, SessionStream> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, SessionStream>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, SessionStream>;
}

function getListenersMap(): Map<string, Set<StreamEventListener>> {
  if (!(globalThis as Record<string, unknown>)[LISTENERS_KEY]) {
    (globalThis as Record<string, unknown>)[LISTENERS_KEY] = new Map<string, Set<StreamEventListener>>();
  }
  return (globalThis as Record<string, unknown>)[LISTENERS_KEY] as Map<string, Set<StreamEventListener>>;
}

// ==========================================
// Helpers
// ==========================================

function buildSnapshot(stream: SessionStream): StreamSnapshot {
  return {
    sessionId: stream.sessionId,
    status: stream.snapshot.status,
    accumulatedText: stream.accumulatedText,
    toolCalls: [...stream.toolCalls],
    isThinking: stream.isThinking,
    error: stream.snapshot.error,
    startedAt: stream.snapshot.startedAt,
    completedAt: stream.snapshot.completedAt,
  };
}

function emit(stream: SessionStream, type: StreamEventType): void {
  const snapshot = buildSnapshot(stream);
  stream.snapshot = snapshot;
  const event: StreamEvent = { type, sessionId: stream.sessionId, snapshot };
  const listeners = getListenersMap().get(stream.sessionId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* listener error — don't crash the stream */
      }
    }
  }
}

function scheduleGC(stream: SessionStream): void {
  if (stream.gcTimer) clearTimeout(stream.gcTimer);
  stream.gcTimer = setTimeout(() => {
    const map = getStreamsMap();
    const current = map.get(stream.sessionId);
    if (current === stream && current.snapshot.status !== "active") {
      map.delete(stream.sessionId);
    }
  }, GC_DELAY_MS);
}

function cleanupTimers(stream: SessionStream): void {
  if (stream.idleCheckTimer) {
    clearInterval(stream.idleCheckTimer);
    stream.idleCheckTimer = null;
  }
}

// ==========================================
// Core: start + run
// ==========================================

export function startStream(params: StartStreamParams, apiCallFn: ApiCallFn): void {
  const map = getStreamsMap();
  const existing = map.get(params.sessionId);

  // If already streaming this session, abort old stream first
  if (existing && existing.snapshot.status === "active") {
    existing.abortController.abort();
    cleanupTimers(existing);
  }

  const abortController = new AbortController();

  const stream: SessionStream = {
    sessionId: params.sessionId,
    abortController,
    snapshot: {
      sessionId: params.sessionId,
      status: "active",
      accumulatedText: "",
      toolCalls: [],
      isThinking: false,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
    },
    accumulatedText: "",
    toolCalls: [],
    isThinking: false,
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    gcTimer: null,
    pausedContext: {
      message: params.message,
      config: params.config,
      history: params.history || [],
      partialText: "",
    },
  };

  map.set(params.sessionId, stream);
  emit(stream, "snapshot-updated");

  // Run the stream in background (non-blocking)
  runStream(stream, params, apiCallFn).catch(() => {});
}

async function runStream(
  stream: SessionStream,
  params: StartStreamParams,
  apiCallFn: ApiCallFn,
): Promise<void> {
  const markActive = () => {
    stream.lastEventTime = Date.now();
  };

  // Idle timeout checker — abort if no events for 330s
  stream.idleCheckTimer = setInterval(() => {
    if (Date.now() - stream.lastEventTime >= STREAM_IDLE_TIMEOUT_MS) {
      cleanupTimers(stream);
      stream.abortController.abort();
      stream.snapshot = {
        ...buildSnapshot(stream),
        status: "error",
        error: `Stream idle timeout (${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s)`,
        completedAt: Date.now(),
      };
      emit(stream, "error");
      scheduleGC(stream);
    }
  }, 10_000);

  // Event handler — accumulates state per-session, independent of React
  const onEvent = (event: AgentEvent): void => {
    if (stream.abortController.signal.aborted) return;
    markActive();

    switch (event.type) {
      case "text":
        stream.isThinking = false;
        if (event.text) stream.accumulatedText += event.text;
        emit(stream, "snapshot-updated");
        break;

      case "thinking":
        stream.isThinking = true;
        if (event.text) stream.accumulatedText += event.text;
        emit(stream, "snapshot-updated");
        break;

      case "tool_use":
        stream.isThinking = false;
        stream.toolCalls = [
          ...stream.toolCalls,
          {
            name: event.toolName || "?",
            input: event.toolInput || "",
            status: "running",
          },
        ];
        emit(stream, "snapshot-updated");
        break;

      case "tool_result": {
        const updated = [...stream.toolCalls];
        const lastRunning = [...updated].reverse().find((c) => c.status === "running");
        if (lastRunning) {
          const idx = updated.indexOf(lastRunning);
          updated[idx] = {
            ...lastRunning,
            status: event.isError ? "error" : "success",
            output: event.toolOutput,
          };
        }
        stream.toolCalls = updated;
        emit(stream, "snapshot-updated");
        break;
      }

      case "error":
        stream.isThinking = false;
        if (event.text) {
          if (stream.accumulatedText.trim()) {
            stream.accumulatedText += `\n\n\u274C ${event.text}`;
          } else {
            stream.accumulatedText = `\u274C ${event.text}`;
          }
        }
        emit(stream, "snapshot-updated");
        break;

      case "result":
        stream.isThinking = false;
        // On result, clean up thinking noise — keep only model output
        if (event.text && event.text.length > 10) {
          const modelText =
            stream.accumulatedText
              .split(
                /\n(?=[\u{1F4AD}\u{1F504}\u{1F4E6}\u{2705}\u{274C}\u{1F4B0}\u{231B}\u{1F3AF}])/u,
              )[0]
              ?.trim() || "";
          stream.accumulatedText = modelText
            ? modelText + "\n\n" + event.text
            : event.text;
        }
        emit(stream, "snapshot-updated");
        break;
    }
  };

  try {
    await apiCallFn(params.message, params.config, onEvent, params.history);

    // Stream completed successfully
    cleanupTimers(stream);
    if (stream.snapshot.status !== "error") {
      stream.snapshot = {
        ...buildSnapshot(stream),
        status: "completed",
        completedAt: Date.now(),
      };
      emit(stream, "completed");
    }
    scheduleGC(stream);
  } catch (error) {
    cleanupTimers(stream);

    // Already handled by idle timeout
    if (stream.snapshot.status === "error" || stream.snapshot.status === "stopped") {
      scheduleGC(stream);
      return;
    }

    const isAbort = error instanceof DOMException && error.name === "AbortError";
    if (isAbort) {
      stream.snapshot = {
        ...buildSnapshot(stream),
        status: "stopped",
        completedAt: Date.now(),
      };
      if (stream.accumulatedText.trim()) {
        stream.accumulatedText += "\n\n*(generation stopped)*";
        stream.snapshot = buildSnapshot(stream);
      }
      emit(stream, "completed");
    } else {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      stream.snapshot = {
        ...buildSnapshot(stream),
        status: "error",
        error: errMsg,
        completedAt: Date.now(),
      };
      emit(stream, "error");
    }
    scheduleGC(stream);
  }
}

// ==========================================
// Snapshot access
// ==========================================

export function getSnapshot(sessionId: string): StreamSnapshot | null {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot ?? null;
}

export function isStreamActive(sessionId: string): boolean {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot.status === "active" || false;
}

// ==========================================
// Subscribe / Unsubscribe
// ==========================================

export function subscribe(
  sessionId: string,
  listener: StreamEventListener,
): () => void {
  const listenersMap = getListenersMap();
  let listeners = listenersMap.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    listenersMap.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      listenersMap.delete(sessionId);
    }
  };
}

export function unsubscribe(
  sessionId: string,
  listener: StreamEventListener,
): void {
  const listenersMap = getListenersMap();
  const listeners = listenersMap.get(sessionId);
  if (listeners) {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersMap.delete(sessionId);
    }
  }
}

// ==========================================
// Abort
// ==========================================

export function abortStream(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && (stream.snapshot.status === "active" || stream.snapshot.status === "paused")) {
    // Also abort through agent-bridge's global controller
    import("./agent-bridge")
      .then((m) => m.abortGeneration())
      .catch(() => {});
    stream.abortController.abort();
    cleanupTimers(stream);
    stream.snapshot = {
      ...buildSnapshot(stream),
      status: "stopped",
      completedAt: Date.now(),
    };
    if (stream.accumulatedText.trim()) {
      stream.accumulatedText += "\n\n*(generation stopped)*";
      stream.snapshot = buildSnapshot(stream);
    }
    emit(stream, "completed");
    scheduleGC(stream);
  }
}

// ==========================================
// Pause / Resume
// ==========================================

export function pauseStream(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.status === "active") {
    // Save partial text for resume context
    if (stream.pausedContext) {
      stream.pausedContext.partialText = stream.accumulatedText;
    }
    // Abort the API call
    import("./agent-bridge")
      .then((m) => m.abortGeneration())
      .catch(() => {});
    stream.abortController.abort();
    cleanupTimers(stream);
    stream.snapshot = {
      ...buildSnapshot(stream),
      status: "paused",
    };
    stream.accumulatedText += "\n\n*(generation paused)*";
    stream.snapshot = buildSnapshot(stream);
    emit(stream, "snapshot-updated");
  }
}

export function resumeStream(sessionId: string, apiCallFn: ApiCallFn): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.status === "paused" && stream.pausedContext) {
    const ctx = stream.pausedContext;

    // Remove the paused marker
    stream.accumulatedText = stream.accumulatedText.replace(/\n\n\*\(generation paused\)\*$/, "");

    // Create new abort controller
    stream.abortController = new AbortController();
    stream.snapshot = {
      ...buildSnapshot(stream),
      status: "active",
    };
    stream.lastEventTime = Date.now();
    emit(stream, "snapshot-updated");

    // Build continuation history: original history + user message + partial assistant response
    const resumeHistory = [
      ...ctx.history,
      { role: "user", content: ctx.message },
    ];
    if (stream.accumulatedText.trim()) {
      resumeHistory.push({ role: "assistant", content: stream.accumulatedText });
    }

    const resumeParams: StartStreamParams = {
      sessionId,
      message: "请继续刚才未完成的回答。",
      config: ctx.config,
      history: resumeHistory,
    };

    // Set up idle timeout again
    stream.idleCheckTimer = setInterval(() => {
      if (Date.now() - stream.lastEventTime >= STREAM_IDLE_TIMEOUT_MS) {
        cleanupTimers(stream);
        stream.abortController.abort();
        stream.snapshot = {
          ...buildSnapshot(stream),
          status: "error",
          error: `Stream idle timeout (${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s)`,
          completedAt: Date.now(),
        };
        emit(stream, "error");
        scheduleGC(stream);
      }
    }, 10_000);

    // Run resumed stream
    runStream(stream, resumeParams, apiCallFn).catch(() => {});
  }
}

export function isPaused(sessionId: string): boolean {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot.status === "paused" || false;
}
