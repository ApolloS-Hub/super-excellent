/**
 * Fork Dispatch — full-inheritance sub-agent (alongside Coordinator).
 *
 * Inspired by keli-wen/agentic-harness-patterns (Multi-agent / 3 modes):
 *
 *   Coordinator  — zero inheritance (subagent has no parent history)
 *   Fork         — full inheritance (subagent has parent's complete context)
 *   Swarm        — flat peer roster (all agents equal)
 *
 * Coordinator is default for Worker dispatch (already implemented in agent-bridge).
 * Fork is used when you want to "explore a branch" while keeping main context.
 *
 * Key properties:
 * - Child inherits parent's conversation history (copy, not reference)
 * - Child runs in a sandbox — its actions don't affect parent state
 * - Child returns a result summary back to parent
 * - Single-level only (forks can't fork) to avoid exponential branches
 */

import type { AgentConfig, AgentEvent } from "./agent-bridge";

export interface ForkOptions {
  /** Parent conversation history — inherited in full */
  parentHistory: Array<{ role: string; content: string }>;
  /** The question/task to explore in the fork */
  question: string;
  /** Config to use (can differ from parent, e.g. different model) */
  config: AgentConfig;
  /** Event callback for the fork's events (should be prefixed for UI clarity) */
  onEvent: (event: AgentEvent) => void;
  /** Optional depth guard (default 0 — forks can't fork) */
  depth?: number;
  /** Timeout in ms (default 60s) */
  timeoutMs?: number;
}

export interface ForkResult {
  success: boolean;
  answer: string;
  durationMs: number;
  tokensUsed?: { input: number; output: number };
  error?: string;
}

const MAX_FORK_DEPTH = 1;

/**
 * Dispatch a Fork subagent — inherits full parent history, runs independently,
 * returns a summary answer.
 */
export async function runFork(options: ForkOptions): Promise<ForkResult> {
  const { parentHistory, question, config, onEvent, depth = 0, timeoutMs = 60000 } = options;
  const startedAt = Date.now();

  if (depth >= MAX_FORK_DEPTH) {
    return {
      success: false,
      answer: "",
      durationMs: 0,
      error: `Fork depth exceeded (max ${MAX_FORK_DEPTH} — forks cannot fork further)`,
    };
  }

  // Emit fork-started so UI shows it distinctly
  onEvent({ type: "thinking", text: `🍴 Fork: ${question.slice(0, 80)}\n` });

  // Capture the fork's text output
  let answer = "";
  const captureEvent = (event: AgentEvent) => {
    if (event.type === "text" && event.text) answer += event.text;
    // Prefix events with [fork] for parent UI clarity
    onEvent({
      ...event,
      text: event.text ? `  [fork] ${event.text}` : event.text,
    });
  };

  // Timeout guard
  const timeoutPromise = new Promise<ForkResult>((_, reject) =>
    setTimeout(() => reject(new Error(`Fork timeout after ${timeoutMs / 1000}s`)), timeoutMs),
  );

  // Delegate to QueryEngine — it will get the inherited history + question
  const executePromise = (async () => {
    try {
      const { runQuery } = await import("./query-engine");
      await runQuery({
        message: question,
        config,
        onEvent: captureEvent,
        history: parentHistory,
      });
      return {
        success: true,
        answer: answer.trim() || "(fork produced no output)",
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        success: false,
        answer: "",
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })();

  try {
    const result = await Promise.race([executePromise, timeoutPromise]);
    onEvent({
      type: "thinking",
      text: `🍴 Fork ${result.success ? "completed" : "failed"} in ${Math.round(result.durationMs / 100) / 10}s\n`,
    });
    return result;
  } catch (err) {
    return {
      success: false,
      answer: "",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run multiple forks in parallel. Useful for "compare 3 approaches".
 * Each fork gets the same parent history + different questions.
 */
export async function runForks(
  parentHistory: Array<{ role: string; content: string }>,
  questions: string[],
  config: AgentConfig,
  onEvent: (event: AgentEvent) => void,
  timeoutMs = 60000,
): Promise<ForkResult[]> {
  const promises = questions.map(q =>
    runFork({ parentHistory, question: q, config, onEvent, timeoutMs }),
  );
  return Promise.all(promises);
}
