/**
 * QueryEngine — core turn orchestration state machine
 *
 * Ported from Claude Code's architecture (query.ts + QueryEngine.ts).
 * One "turn" = gather context → take action → verify results.
 *
 * Responsibilities:
 *   - Assemble system prompt (identity + tools + context + memory)
 *   - Select provider callable (anthropic/openai/google)
 *   - Drive the turn: request → parse stop_reason → dispatch tools → feed results → repeat
 *   - Track worker state transitions (thinking/tool_running/completed)
 *   - Emit canonical events to the stream
 *
 * This file does NOT know about:
 *   - UI rendering
 *   - Slash commands (control plane)
 *   - Conversation persistence
 *
 * It receives a user message + config and drives a single turn to completion.
 */

import type { AgentConfig, AgentEvent } from "./agent-bridge";
import i18n from "../i18n";

export type EventCallback = (event: AgentEvent) => void;

export type TurnPhase =
  | "starting"      // Before any API call
  | "thinking"      // Waiting for LLM response
  | "tool_running"  // Executing a tool
  | "finalizing"    // Building final text
  | "done"          // Completed successfully
  | "error"         // Failed with error
  | "aborted";      // User cancelled

export interface TurnState {
  phase: TurnPhase;
  turnCount: number;
  maxTurns: number;
  toolCallCount: number;
  startedAt: number;
}

export interface QueryOptions {
  message: string;
  config: AgentConfig;
  onEvent: EventCallback;
  history?: Array<{ role: string; content: string }>;
  /** Optional worker context for role-enhanced prompts */
  worker?: { id: string; name: string; systemPrompt: string };
  /** Max turns per query (default 10) */
  maxTurns?: number;
}

/**
 * Main entry: drive one query to completion.
 *
 * Delegates to provider-specific callAnthropic/callOpenAI/callGemini
 * that are still defined in agent-bridge.ts for now. Over time those
 * will move into this module as separate files (providers/anthropic.ts
 * etc.) — but extracting them all at once is risky. This first pass
 * just gives us a clean entry point.
 */
export async function runQuery(options: QueryOptions): Promise<void> {
  const { message, config, onEvent, history, worker, maxTurns: _maxTurns } = options;

  // Build the actual message with worker role injection if present
  const finalMessage = worker
    ? `[Role: ${worker.name}]\n${worker.systemPrompt}\n\n[User Request]\n${message}`
    : message;

  // Provider dispatch — each one handles its own turn loop internally
  const bridge = await import("./agent-bridge");

  const provider = config.provider;
  if (provider === "anthropic") {
    await bridge.callAnthropic(finalMessage, config, onEvent, history);
  } else if (provider === "google") {
    await bridge.callGemini(finalMessage, config, onEvent, history);
  } else {
    const finalConfig = provider === "kimi"
      ? { ...config, baseURL: config.baseURL || "https://api.moonshot.cn/v1" }
      : config;
    await bridge.callOpenAI(finalMessage, finalConfig, onEvent, history);
  }
}

/**
 * Build the localized label for a turn phase (for UI display).
 */
export function formatTurnPhase(phase: TurnPhase): string {
  const isZh = i18n.language.startsWith("zh");
  const labels: Record<TurnPhase, { zh: string; en: string }> = {
    starting: { zh: "准备中", en: "Starting" },
    thinking: { zh: "思考中", en: "Thinking" },
    tool_running: { zh: "执行工具", en: "Running tool" },
    finalizing: { zh: "整理结果", en: "Finalizing" },
    done: { zh: "完成", en: "Done" },
    error: { zh: "出错", en: "Error" },
    aborted: { zh: "已取消", en: "Aborted" },
  };
  return isZh ? labels[phase].zh : labels[phase].en;
}

/**
 * Create initial turn state.
 */
export function createTurnState(maxTurns: number = 10): TurnState {
  return {
    phase: "starting",
    turnCount: 0,
    maxTurns,
    toolCallCount: 0,
    startedAt: Date.now(),
  };
}
