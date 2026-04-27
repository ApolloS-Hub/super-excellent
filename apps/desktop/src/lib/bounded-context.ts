/**
 * Bounded Context — Garden Skills / RAG-skill inspired.
 *
 * Prevents unbounded multi-turn loops from consuming infinite tokens.
 * Three levels of bounds:
 *   1. Per-worker tool iterations (already MAX_WORKER_ITERATIONS in coordinator)
 *   2. Per-scenario step count (enforced here)
 *   3. Per-conversation turn counter (triggers summarization hint)
 *
 * The key insight from garden-skills' rag-skill: instead of processing
 * everything, build an index first, then read progressively with a hard
 * ceiling. When the ceiling is hit, stop and summarize what you have.
 */
import { emitAgentEvent } from "./event-bus";

// ═══════════ Conversation Turn Tracking ═══════════

interface TurnTracker {
  conversationId: string;
  turnCount: number;
  totalTokenEstimate: number;
  lastSummarizedAt: number;
}

const _trackers = new Map<string, TurnTracker>();

const DEFAULT_MAX_TURNS_BEFORE_SUMMARY = 15;
const DEFAULT_MAX_TOKENS_ESTIMATE = 50_000;
const STORAGE_KEY = "bounded-context-config";

export interface BoundedContextConfig {
  maxTurnsBeforeSummary: number;
  maxTokenEstimate: number;
  enabled: boolean;
}

export function getConfig(): BoundedContextConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    maxTurnsBeforeSummary: DEFAULT_MAX_TURNS_BEFORE_SUMMARY,
    maxTokenEstimate: DEFAULT_MAX_TOKENS_ESTIMATE,
    enabled: true,
  };
}

export function setConfig(cfg: Partial<BoundedContextConfig>): void {
  const current = getConfig();
  const merged = { ...current, ...cfg };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
}

// ═══════════ Turn tracking ═══════════

export function recordTurn(conversationId: string, inputLength: number, outputLength: number): TurnTracker {
  let tracker = _trackers.get(conversationId);
  if (!tracker) {
    tracker = { conversationId, turnCount: 0, totalTokenEstimate: 0, lastSummarizedAt: 0 };
    _trackers.set(conversationId, tracker);
  }
  tracker.turnCount++;
  // Rough token estimate: ~4 chars per token for English, ~2 for Chinese
  tracker.totalTokenEstimate += Math.ceil((inputLength + outputLength) / 3);
  return tracker;
}

export function getTracker(conversationId: string): TurnTracker | null {
  return _trackers.get(conversationId) || null;
}

export function resetTracker(conversationId: string): void {
  _trackers.delete(conversationId);
}

// ═══════════ Bound checks ═══════════

export interface BoundCheckResult {
  shouldSummarize: boolean;
  reason?: string;
  turnCount: number;
  tokenEstimate: number;
}

export function checkBounds(conversationId: string): BoundCheckResult {
  const config = getConfig();
  const tracker = _trackers.get(conversationId);

  if (!config.enabled || !tracker) {
    return { shouldSummarize: false, turnCount: tracker?.turnCount || 0, tokenEstimate: tracker?.totalTokenEstimate || 0 };
  }

  const turnsSinceSummary = tracker.turnCount - tracker.lastSummarizedAt;

  if (turnsSinceSummary >= config.maxTurnsBeforeSummary) {
    return {
      shouldSummarize: true,
      reason: `${turnsSinceSummary} turns since last summary (limit: ${config.maxTurnsBeforeSummary})`,
      turnCount: tracker.turnCount,
      tokenEstimate: tracker.totalTokenEstimate,
    };
  }

  if (tracker.totalTokenEstimate >= config.maxTokenEstimate) {
    return {
      shouldSummarize: true,
      reason: `~${tracker.totalTokenEstimate} tokens used (limit: ${config.maxTokenEstimate})`,
      turnCount: tracker.turnCount,
      tokenEstimate: tracker.totalTokenEstimate,
    };
  }

  return { shouldSummarize: false, turnCount: tracker.turnCount, tokenEstimate: tracker.totalTokenEstimate };
}

export function markSummarized(conversationId: string): void {
  const tracker = _trackers.get(conversationId);
  if (tracker) {
    tracker.lastSummarizedAt = tracker.turnCount;
    emitAgentEvent({
      type: "intent_analysis",
      intentType: "bounded_context",
      text: `Conversation summarized at turn ${tracker.turnCount}`,
    });
  }
}

/**
 * Build a summary prompt hint that the coordinator can inject when bounds are hit.
 * This tells the model: "you've been going for a while, please summarize first."
 */
export function buildSummaryHint(check: BoundCheckResult): string {
  return [
    "[Bounded Context Notice]",
    `This conversation has reached ${check.turnCount} turns (~${check.tokenEstimate} tokens).`,
    `Reason: ${check.reason}`,
    "",
    "Before continuing, please briefly summarize:",
    "1. What has been accomplished so far",
    "2. What remains to be done",
    "3. Any key decisions or findings",
    "",
    "Then proceed with the next step. This keeps context focused and prevents token waste.",
  ].join("\n");
}

// ═══════════ Scenario bounds ═══════════

export const MAX_SCENARIO_STEPS = 10;

export function checkScenarioBounds(currentStep: number, totalSteps: number): { allowed: boolean; message?: string } {
  if (currentStep >= MAX_SCENARIO_STEPS) {
    return {
      allowed: false,
      message: `Scenario reached ${MAX_SCENARIO_STEPS}-step limit. Summarizing completed steps and stopping.`,
    };
  }
  if (currentStep >= totalSteps) {
    return { allowed: true }; // natural completion
  }
  return { allowed: true };
}
