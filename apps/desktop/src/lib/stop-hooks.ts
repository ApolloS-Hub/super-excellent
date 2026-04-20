/**
 * StopHooks — end-of-turn automatic actions
 *
 * Inspired by cc-haha's stopHooks.ts pattern:
 * After each conversation turn completes, run background actions:
 *   1. Memory extraction — extract user preferences/patterns from the turn
 *   2. Conversation compaction — if context is getting long, summarize
 *   3. Usage recording — log token/cost data
 *   4. Prompt suggestions — generate follow-up hints (optional)
 *
 * These run AFTER the response is delivered to the user (non-blocking).
 * They should never throw — failures are logged but don't break the flow.
 */

export interface StopHookContext {
  userMessage: string;
  assistantResponse: string;
  turnCount: number;
  toolsUsed: string[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** The worker that handled this turn (if any) */
  workerId?: string;
  workerName?: string;
}

export interface StopHookResult {
  hookName: string;
  success: boolean;
  durationMs: number;
  detail?: string;
}

type StopHook = (ctx: StopHookContext) => Promise<StopHookResult>;

const hooks: Array<{ name: string; hook: StopHook; priority: number }> = [];

export function registerStopHook(name: string, hook: StopHook, priority: number = 50): void {
  hooks.push({ name, hook, priority });
  hooks.sort((a, b) => a.priority - b.priority);
}

export function clearStopHooks(): void {
  hooks.length = 0;
}

/**
 * Run all stop hooks after a turn completes. Non-blocking, fire-and-forget.
 * Returns results for observability but never throws.
 */
export async function runStopHooks(ctx: StopHookContext): Promise<StopHookResult[]> {
  const results: StopHookResult[] = [];
  for (const { name, hook } of hooks) {
    const start = Date.now();
    try {
      const result = await hook(ctx);
      results.push(result);
    } catch (err) {
      results.push({
        hookName: name,
        success: false,
        durationMs: Date.now() - start,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ═══════════ Built-in hooks ═══════════

/**
 * Hook 1: Memory extraction — learn from the conversation turn.
 * Extracts user preferences, coding style, frequently used tools.
 */
const memoryExtractionHook: StopHook = async (ctx) => {
  const start = Date.now();
  try {
    const { recordConversation, updateUserPreference } = await import("./memory-bridge");

    // Record the conversation for long-term retrieval
    await recordConversation(ctx.userMessage, ctx.assistantResponse);

    // Auto-detect preferences from the exchange
    const prefs = detectPreferences(ctx.userMessage, ctx.assistantResponse);
    for (const pref of prefs) {
      await updateUserPreference(pref.key, pref.value);
    }

    return {
      hookName: "memory_extraction",
      success: true,
      durationMs: Date.now() - start,
      detail: prefs.length > 0 ? `Extracted ${prefs.length} preferences` : "Recorded",
    };
  } catch (err) {
    return {
      hookName: "memory_extraction",
      success: false,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Hook 2: Usage recording — centralized cost/token logging.
 */
const usageRecordingHook: StopHook = async (ctx) => {
  const start = Date.now();
  try {
    const { recordUsage } = await import("./cost-tracker");
    recordUsage(ctx.provider, ctx.model, {
      prompt_tokens: ctx.tokensIn,
      completion_tokens: ctx.tokensOut,
    });
    return {
      hookName: "usage_recording",
      success: true,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      hookName: "usage_recording",
      success: false,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Hook 3: Learning engine — extract patterns for mid-term memory.
 */
const learningHook: StopHook = async (ctx) => {
  const start = Date.now();
  try {
    const { analyzeConversation, ingestUserMessage, ingestAssistantMessage } = await import("./learning-engine");
    ingestUserMessage(ctx.userMessage);
    ingestAssistantMessage(ctx.assistantResponse);

    const turns = [
      { role: "user" as const, content: ctx.userMessage },
      { role: "assistant" as const, content: ctx.assistantResponse },
      ...ctx.toolsUsed.map(t => ({ role: "tool" as const, content: "", toolName: t })),
    ];
    const patterns = await analyzeConversation(turns);

    return {
      hookName: "learning",
      success: true,
      durationMs: Date.now() - start,
      detail: patterns.length > 0 ? `${patterns.length} patterns` : undefined,
    };
  } catch (err) {
    return {
      hookName: "learning",
      success: false,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Hook 4: Auto-compact — if conversation is getting long, refresh mid-term cache.
 */
const autoCompactHook: StopHook = async (ctx) => {
  const start = Date.now();
  if (ctx.turnCount < 5) {
    return { hookName: "auto_compact", success: true, durationMs: 0, detail: "skipped (early)" };
  }
  try {
    const { refreshMidTermCache } = await import("./agent-bridge");
    await refreshMidTermCache();
    return { hookName: "auto_compact", success: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      hookName: "auto_compact",
      success: false,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

// ═══════════ Preference detection ═══════════

interface DetectedPreference {
  key: string;
  value: string;
}

function detectPreferences(userMsg: string, _assistantMsg: string): DetectedPreference[] {
  const prefs: DetectedPreference[] = [];
  const msg = userMsg.toLowerCase();

  // Language preference
  if (/用中文|中文回答|用中文回复/.test(msg)) {
    prefs.push({ key: "response_language", value: "zh-CN" });
  } else if (/in english|respond in english|use english/.test(msg)) {
    prefs.push({ key: "response_language", value: "en-US" });
  }

  // Code style preferences
  if (/typescript|\.tsx?/.test(msg)) prefs.push({ key: "preferred_language", value: "TypeScript" });
  if (/python|\.py/.test(msg)) prefs.push({ key: "preferred_language", value: "Python" });
  if (/简洁|concise|简短|brief/.test(msg)) prefs.push({ key: "response_style", value: "concise" });
  if (/详细|detailed|verbose/.test(msg)) prefs.push({ key: "response_style", value: "detailed" });

  return prefs;
}

// ═══════════ Registration ═══════════

/** Register all built-in hooks. Call once at app startup. */
export function initStopHooks(): void {
  clearStopHooks();
  registerStopHook("memory_extraction", memoryExtractionHook, 10);
  registerStopHook("usage_recording", usageRecordingHook, 20);
  registerStopHook("learning", learningHook, 30);
  registerStopHook("auto_compact", autoCompactHook, 90);
}
