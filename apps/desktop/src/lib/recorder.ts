/**
 * Recorder — record and replay tool invocations.
 *
 * Modes:
 *   Record:    captures every tool call with args, result, and timing.
 *   Playback:  replays recorded operations (for debugging / demos).
 *   ZeroToken: playback without LLM calls — returns cached results directly.
 *
 * Data is exportable as JSON.
 */

// ────────────────────────── Types ──────────────────────────

export interface RecordedStep {
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  duration: number;
}

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  steps: RecordedStep[];
}

export type RecorderMode = "idle" | "recording" | "playing";

export interface PlaybackEvent {
  type: "step" | "done" | "error";
  step?: RecordedStep;
  index?: number;
  total?: number;
  error?: string;
}

type PlaybackListener = (event: PlaybackEvent) => void;

// ────────────────────────── State ──────────────────────────

let mode: RecorderMode = "idle";
let activeRecording: Recording | null = null;
let playbackListeners: PlaybackListener[] = [];
let playbackAborted = false;

// ────────────────────────── Recording API ──────────────────────────

export function startRecording(name?: string): void {
  activeRecording = {
    id: `rec_${Date.now().toString(36)}`,
    name: name || `Recording ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    steps: [],
  };
  mode = "recording";
}

export function stopRecording(): Recording | null {
  if (mode !== "recording" || !activeRecording) return null;
  const result = { ...activeRecording, steps: [...activeRecording.steps] };
  mode = "idle";
  activeRecording = null;
  return result;
}

export function isRecording(): boolean {
  return mode === "recording";
}

export function getRecorderMode(): RecorderMode {
  return mode;
}

/**
 * Record a single tool invocation. Call this around every executeTool.
 * Returns the original result unchanged.
 */
export function recordStep(
  tool: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number,
): void {
  if (mode !== "recording" || !activeRecording) return;
  activeRecording.steps.push({
    timestamp: Date.now(),
    tool,
    args,
    result,
    duration: durationMs,
  });
}

/**
 * Wrap an async tool executor to automatically record steps when recording is active.
 */
export function withRecording<T extends Record<string, unknown>>(
  executor: (name: string, args: T) => Promise<string>,
): (name: string, args: T) => Promise<string> {
  return async (name: string, args: T): Promise<string> => {
    const start = performance.now();
    const result = await executor(name, args);
    const elapsed = performance.now() - start;
    recordStep(name, args, result, Math.round(elapsed));
    return result;
  };
}

// ────────────────────────── Playback API ──────────────────────────

export function onPlayback(listener: PlaybackListener): () => void {
  playbackListeners.push(listener);
  return () => {
    playbackListeners = playbackListeners.filter((l) => l !== listener);
  };
}

function emitPlayback(event: PlaybackEvent): void {
  for (const l of playbackListeners) {
    try { l(event); } catch { /* listener errors don't break playback */ }
  }
}

/**
 * Play back a recording. Each step is emitted to listeners with an optional delay.
 * In ZeroToken mode, tool results come from the recording — no LLM needed.
 */
export async function playRecording(
  recording: Recording,
  options?: { delayMs?: number; zeroToken?: boolean },
): Promise<void> {
  const delay = options?.delayMs ?? 500;
  mode = "playing";
  playbackAborted = false;

  for (let i = 0; i < recording.steps.length; i++) {
    if (playbackAborted) {
      emitPlayback({ type: "error", error: "Playback aborted" });
      mode = "idle";
      return;
    }

    const step = recording.steps[i];
    emitPlayback({ type: "step", step, index: i, total: recording.steps.length });

    if (delay > 0) {
      await sleep(delay);
    }
  }

  emitPlayback({ type: "done" });
  mode = "idle";
}

export function abortPlayback(): void {
  playbackAborted = true;
}

// ────────────────────────── ZeroToken Lookup ──────────────────────────

/**
 * Build a lookup table from a recording for ZeroToken mode.
 * Key: "toolName:JSON(args)" → result string.
 */
export function buildZeroTokenCache(
  recording: Recording,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const step of recording.steps) {
    const key = zeroTokenKey(step.tool, step.args);
    cache.set(key, step.result);
  }
  return cache;
}

/**
 * Look up a cached result. Returns undefined on miss.
 */
export function zeroTokenLookup(
  cache: Map<string, string>,
  tool: string,
  args: Record<string, unknown>,
): string | undefined {
  return cache.get(zeroTokenKey(tool, args));
}

function zeroTokenKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

// ────────────────────────── Import / Export ──────────────────────────

export function exportRecording(recording: Recording): string {
  return JSON.stringify(recording, null, 2);
}

export function importRecording(json: string): Recording {
  const parsed: unknown = JSON.parse(json);
  if (!isRecordingShape(parsed)) {
    throw new Error("Invalid recording format");
  }
  return parsed;
}

// ────────────────────────── localStorage persistence ──────────────────────────

const STORAGE_KEY = "recordings";

export function saveRecordingToStorage(recording: Recording): void {
  const all = listRecordingsFromStorage();
  const idx = all.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    all[idx] = recording;
  } else {
    all.push(recording);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function listRecordingsFromStorage(): Recording[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecordingShape);
  } catch {
    return [];
  }
}

export function deleteRecordingFromStorage(id: string): void {
  const all = listRecordingsFromStorage().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// ────────────────────────── Helpers ──────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRecordingShape(v: unknown): v is Recording {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.createdAt === "number" &&
    Array.isArray(obj.steps)
  );
}
