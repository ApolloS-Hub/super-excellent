/**
 * ralph-loop.ts — Persistent completion loop (oh-my-codex pattern)
 *
 * Keeps iterating: load pre-context → execute → verify → architect review
 * → deslop → regression. Stops on success or when max iterations hit.
 * Each iteration is recorded so the user can audit or resume.
 */

import { isTauriAvailable, writeFileTauri } from "./tauri-bridge";

export type RalphStage = "pre-context" | "execute" | "verify" | "review" | "deslop" | "regression";

export interface RalphStageResult {
  stage: RalphStage;
  ok: boolean;
  detail: string;
  startedAt: number;
  durationMs: number;
}

export interface RalphIteration {
  n: number;
  stages: RalphStageResult[];
  ok: boolean;
  summary?: string;
}

export interface RalphSession {
  id: string;
  goal: string;
  maxIterations: number;
  iterations: RalphIteration[];
  done: boolean;
  startedAt: number;
  finishedAt?: number;
}

export const STAGES: RalphStage[] = ["pre-context", "execute", "verify", "review", "deslop", "regression"];

export function startRalph(goal: string, maxIterations = 5): RalphSession {
  return {
    id: `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    goal,
    maxIterations,
    iterations: [],
    done: false,
    startedAt: Date.now(),
  };
}

/**
 * Run a single stage. `runner` is user-supplied and returns {ok, detail}.
 * The loop does NOT auto-execute AI work; it structures the progression
 * so callers can wire each stage to their actual agent bridge.
 */
export async function runStage(
  stage: RalphStage,
  runner: () => Promise<{ ok: boolean; detail: string }>,
): Promise<RalphStageResult> {
  const started = Date.now();
  try {
    const r = await runner();
    return { stage, ok: r.ok, detail: r.detail, startedAt: started, durationMs: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage, ok: false, detail: msg, startedAt: started, durationMs: Date.now() - started };
  }
}

/**
 * Append a stage result to the current iteration (creating one if needed).
 * Returns the updated session. Marks done=true when the last iteration
 * succeeds fully or the cap is reached.
 */
export function appendStageResult(session: RalphSession, result: RalphStageResult): RalphSession {
  const iterations = [...session.iterations];
  let current = iterations[iterations.length - 1];
  if (!current || current.stages.length === STAGES.length) {
    current = { n: iterations.length + 1, stages: [], ok: false };
    iterations.push(current);
  }
  current.stages = [...current.stages, result];
  const complete = current.stages.length === STAGES.length;
  if (complete) {
    current.ok = current.stages.every(s => s.ok);
    current.summary = current.ok
      ? `iteration ${current.n} passed all ${STAGES.length} stages`
      : `iteration ${current.n} failed: ${current.stages.filter(s => !s.ok).map(s => s.stage).join(", ")}`;
  }
  const done = (complete && current.ok) || iterations.length >= session.maxIterations;
  return {
    ...session,
    iterations,
    done,
    finishedAt: done ? Date.now() : undefined,
  };
}

export function currentIteration(session: RalphSession): RalphIteration | null {
  return session.iterations[session.iterations.length - 1] ?? null;
}

export function nextStage(session: RalphSession): RalphStage | null {
  if (session.done) return null;
  const cur = currentIteration(session);
  if (!cur || cur.stages.length === STAGES.length) return STAGES[0];
  return STAGES[cur.stages.length];
}

export function renderSession(session: RalphSession): string {
  const lines = [
    `# Ralph loop — ${session.goal}`,
    "",
    `- **ID**: ${session.id}`,
    `- **Iterations**: ${session.iterations.length}/${session.maxIterations}`,
    `- **Done**: ${session.done ? "✅" : "⏳"}`,
    "",
  ];
  for (const it of session.iterations) {
    lines.push(`## Iteration ${it.n} — ${it.ok ? "✅" : it.stages.length === STAGES.length ? "❌" : "⏳"}`, "");
    for (const s of it.stages) {
      lines.push(`- **${s.stage}** ${s.ok ? "✅" : "❌"} (${s.durationMs}ms): ${s.detail}`);
    }
    if (it.summary) lines.push("", `_${it.summary}_`, "");
  }
  return lines.join("\n");
}

export async function saveSession(session: RalphSession, workDir: string): Promise<string | null> {
  if (!isTauriAvailable() || !workDir) return null;
  const path = `${workDir}/.omx/sessions/${session.id}.md`;
  try {
    await writeFileTauri(path, renderSession(session));
    return path;
  } catch {
    return null;
  }
}
