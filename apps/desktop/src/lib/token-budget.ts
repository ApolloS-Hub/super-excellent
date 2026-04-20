/**
 * TokenBudget — centralized token accounting
 *
 * Inspired by cc-haha's query/tokenBudget.ts.
 * Single source of truth for:
 *   - Per-turn token usage tracking
 *   - Session-wide budget limits
 *   - Auto-compact trigger decisions
 *   - Cost estimation across providers
 *   - Token estimation for strings
 *
 * Previously scattered across agent-bridge.ts, cost-tracker.ts, prompt-cache.ts.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TurnBudgetSnapshot {
  turn: number;
  usage: TokenUsage;
  estimatedCost: number;
  contextWindowUsedPercent: number;
  shouldCompact: boolean;
}

export interface SessionBudget {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  turnCount: number;
  /** Max budget in USD (0 = unlimited) */
  maxBudgetUsd: number;
  /** Context window size for the current model */
  contextWindowSize: number;
}

// ═══════════ Model context windows ═══════════

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-opus-4": 200000,
  "claude-sonnet-4": 200000,
  "claude-haiku-4": 200000,
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "o4-mini": 128000,
  "o3-pro": 128000,
  // Google
  "gemini-2.5-pro": 1000000,
  "gemini-2.5-flash": 1000000,
  // DeepSeek
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
  // Kimi
  "moonshot-v1-128k": 128000,
  "moonshot-v1-32k": 32000,
  "kimi-k2.5": 131072,
  // Qwen
  "qwen-max": 32768,
  "qwen-plus": 131072,
  "qwen-long": 1000000,
  // Ollama
  "llama3.1": 131072,
  "llama3": 8192,
};

// ═══════════ Cost rates (per 1M tokens) ═══════════

const COST_RATES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4": { input: 0.25, output: 1.25, cacheRead: 0.025, cacheWrite: 0.3125 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
};

const COMPACT_THRESHOLD = 0.80; // Trigger compact at 80% of context window

// ═══════════ Session state ═══════════

let session: SessionBudget = createSession();

function createSession(contextWindow?: number, maxBudget?: number): SessionBudget {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    turnCount: 0,
    maxBudgetUsd: maxBudget ?? 0,
    contextWindowSize: contextWindow ?? 200000,
  };
}

// ═══════════ Public API ═══════════

/**
 * Initialize/reset the session budget for a new conversation.
 */
export function initBudget(model?: string, maxBudgetUsd?: number): void {
  const contextWindow = model ? getContextWindow(model) : 200000;
  session = createSession(contextWindow, maxBudgetUsd);
}

/**
 * Record usage for one turn. Returns a snapshot with compact/budget decisions.
 */
export function recordTurnUsage(usage: Partial<TokenUsage>, model?: string): TurnBudgetSnapshot {
  session.turnCount++;
  session.totalInputTokens += usage.inputTokens ?? 0;
  session.totalOutputTokens += usage.outputTokens ?? 0;
  session.totalCacheReadTokens += usage.cacheReadTokens ?? 0;
  session.totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;

  const cost = estimateCost(usage, model);
  session.totalCost += cost;

  const lastPromptTokens = usage.inputTokens ?? 0;
  const contextUsed = lastPromptTokens / session.contextWindowSize;

  return {
    turn: session.turnCount,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    },
    estimatedCost: cost,
    contextWindowUsedPercent: Math.round(contextUsed * 100),
    shouldCompact: contextUsed > COMPACT_THRESHOLD,
  };
}

/**
 * Check if we've exceeded the budget.
 */
export function isBudgetExceeded(): boolean {
  return session.maxBudgetUsd > 0 && session.totalCost >= session.maxBudgetUsd;
}

/**
 * Get current session totals.
 */
export function getSessionBudget(): Readonly<SessionBudget> {
  return { ...session };
}

/**
 * Get the context window size for a model.
 */
export function getContextWindow(model: string): number {
  const key = Object.keys(MODEL_CONTEXT_WINDOWS).find(
    k => model.toLowerCase().includes(k.toLowerCase()),
  );
  return key ? MODEL_CONTEXT_WINDOWS[key] : 128000;
}

/**
 * Estimate cost for a usage record.
 */
export function estimateCost(usage: Partial<TokenUsage>, model?: string): number {
  const rates = model
    ? COST_RATES[Object.keys(COST_RATES).find(k => model.includes(k)) ?? ""] ?? COST_RATES["claude-sonnet-4"]
    : COST_RATES["claude-sonnet-4"];

  const inputCost = (usage.inputTokens ?? 0) * rates.input / 1_000_000;
  const outputCost = (usage.outputTokens ?? 0) * rates.output / 1_000_000;
  const cacheReadCost = (usage.cacheReadTokens ?? 0) * rates.cacheRead / 1_000_000;
  const cacheWriteCost = (usage.cacheWriteTokens ?? 0) * rates.cacheWrite / 1_000_000;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Estimate tokens for a string.
 * Rough: 1 token ≈ 4 chars English, 1.5 chars CJK.
 */
export function estimateTokens(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/**
 * Get remaining token budget for a turn (context window - current usage).
 */
export function getRemainingContextTokens(currentPromptTokens: number): number {
  return Math.max(0, session.contextWindowSize - currentPromptTokens);
}

/**
 * Check if context should be compacted based on current prompt tokens.
 */
export function shouldCompact(currentPromptTokens: number): boolean {
  return currentPromptTokens > session.contextWindowSize * COMPACT_THRESHOLD;
}

/**
 * Format a cost value as a readable string.
 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format token count as readable string.
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}
