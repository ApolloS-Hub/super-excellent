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
import { runStopHooks } from "./stop-hooks";
import { audit } from "./audit-logger";
import { recordTurnUsage, initBudget } from "./token-budget";
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

// ═══════════ Adaptive Computation (OpenMythos ACT pattern) ═══════════

interface ComplexityEstimate {
  level: "trivial" | "simple" | "moderate" | "complex" | "deep";
  maxTokens: number;
  maxTurns: number;
  budgetUsd: number;
}

/**
 * Estimate task complexity from the message content.
 * Simpler tasks get fewer turns + smaller token budget.
 * Complex tasks get more turns + larger budget.
 */
function estimateComplexity(message: string, hasWorker: boolean): ComplexityEstimate {
  const len = message.length;
  const wordCount = message.split(/\s+/).length;

  // Signals of complexity
  const hasMultiStep = /先.*再|然后|第[一二三]步|step\s*\d|1\).*2\)|从.*到/i.test(message);
  const hasCode = /```|function|import |class |def |const |let |var /i.test(message);
  const hasAnalysis = /分析|比较|评估|研究|调研|analyze|compare|evaluate|research/i.test(message);
  const isGreeting = /^(hi|hello|你好|嗨|hey|哈喽)\s*[!？?。.]*$/i.test(message.trim());

  if (isGreeting || len < 15) {
    return { level: "trivial", maxTokens: 1024, maxTurns: 2, budgetUsd: 0.005 };
  }
  if (!hasWorker && wordCount < 20 && !hasMultiStep && !hasCode) {
    return { level: "simple", maxTokens: 2048, maxTurns: 3, budgetUsd: 0.01 };
  }
  if (hasMultiStep || (hasAnalysis && hasCode)) {
    return { level: "complex", maxTokens: 8192, maxTurns: 10, budgetUsd: 0.1 };
  }
  if (hasMultiStep && hasCode && wordCount > 100) {
    return { level: "deep", maxTokens: 8192, maxTurns: 15, budgetUsd: 0.2 };
  }
  return { level: "moderate", maxTokens: 4096, maxTurns: 8, budgetUsd: 0.05 };
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

  // Inject matched skills into the message for workflow guidance
  let skillSection = "";
  try {
    const { buildSkillPrompt } = await import("./skills");
    skillSection = buildSkillPrompt(message);
  } catch { /* skills module not available */ }

  // Inject user instruction rules (takes priority over auto-learned)
  let instructionSection = "";
  try {
    const { buildInstructionPrompt } = await import("./instruction-memory");
    instructionSection = buildInstructionPrompt();
  } catch { /* instruction-memory not available */ }

  // Build the actual message with worker role + instructions + skill injection
  const injections = [instructionSection, skillSection].filter(Boolean).join("\n\n");
  let finalMessage = message;
  if (worker) {
    finalMessage = `[Role: ${worker.name}]\n${worker.systemPrompt}${injections ? "\n\n" + injections : ""}\n\n[User Request]\n${message}`;
  } else if (injections) {
    finalMessage = `${injections}\n\n[User Request]\n${message}`;
  }

  // ── Adaptive Computation (inspired by OpenMythos ACT) ──
  // Simple tasks get fewer turns + smaller token budget.
  // Complex tasks get more turns + larger budget.
  const complexity = estimateComplexity(message, !!worker);
  const adaptiveMaxTokens = complexity.maxTokens;

  // Audit: query started
  const queryStartedAt = Date.now();
  audit("api_call", worker?.id ?? "secretary", config.provider,
    `${complexity.level} | ${message.slice(0, 80)}`);


  // Initialize token budget with adaptive context awareness
  initBudget(config.model, complexity.budgetUsd);

  // Log adaptive decision (visible in Monitor page event log)
  try {
    const { emitAgentEvent } = await import("./event-bus");
    emitAgentEvent({
      type: "adaptive_computation",
      level: complexity.level,
      maxTokens: adaptiveMaxTokens,
      maxTurns: complexity.maxTurns,
      budgetUsd: complexity.budgetUsd,
    });
  } catch { /* event-bus not available */ }

  // Track response text and tool calls for StopHooks
  let responseText = "";
  const toolsUsed: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  const wrappedOnEvent: EventCallback = (event) => {
    // Capture data for post-turn hooks
    if (event.type === "text" && event.text) responseText += event.text;
    if (event.type === "tool_use" && event.toolName) {
      toolsUsed.push(event.toolName);
      audit("tool_execute", worker?.id ?? "secretary", event.toolName,
        event.toolInput?.slice(0, 200));
    }
    if (event.type === "tool_result" && event.toolName) {
      audit("tool_result", worker?.id ?? "secretary", event.toolName,
        event.toolOutput?.slice(0, 200), { ok: !event.isError });
    }
    onEvent(event);
  };

  // Provider dispatch — each one handles its own turn loop internally
  const bridge = await import("./agent-bridge");

  const provider = config.provider;
  if (provider === "anthropic") {
    await bridge.callAnthropic(finalMessage, config, wrappedOnEvent, history);
  } else if (provider === "google") {
    await bridge.callGemini(finalMessage, config, wrappedOnEvent, history);
  } else {
    const finalConfig = provider === "kimi"
      ? { ...config, baseURL: config.baseURL || "https://api.moonshot.cn/v1" }
      : config;
    await bridge.callOpenAI(finalMessage, finalConfig, wrappedOnEvent, history);
  }

  // Record turn in token budget
  tokensIn = Math.ceil(message.length / 4);
  tokensOut = Math.ceil(responseText.length / 4);
  const snapshot = recordTurnUsage({ inputTokens: tokensIn, outputTokens: tokensOut }, config.model);

  // Run StopHooks in background (non-blocking, fire-and-forget)
  runStopHooks({
    userMessage: message,
    assistantResponse: responseText.slice(0, 2000),
    turnCount: snapshot.turn,
    toolsUsed,
    provider: config.provider,
    model: config.model,
    tokensIn,
    tokensOut,
    costUsd: snapshot.estimatedCost,
    workerId: worker?.id,
    workerName: worker?.name,
  }).catch(() => { /* never block on hook failures */ });

  // Audit: query completed
  audit("api_call", worker?.id ?? "secretary", config.provider,
    `completed | ${tokensIn}+${tokensOut} tokens | ${toolsUsed.length} tools | $${snapshot.estimatedCost.toFixed(4)}`,
    { durationMs: Date.now() - queryStartedAt, ok: true });
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
