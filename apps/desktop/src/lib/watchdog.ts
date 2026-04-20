/**
 * Watchdog — API 调用自修复模块
 *
 * 策略：
 * - 连续失败 3 次 → 自动降级（同 Provider 换模型 → 换 Provider）
 * - 网络错误 → 指数退避重试（1s, 2s, 4s）
 * - 降级后每 60s 尝试恢复原始配置
 */

interface ProviderFallback {
  provider: string;
  models: string[];
}

const FALLBACK_CHAIN: ProviderFallback[] = [
  { provider: "anthropic", models: ["claude-sonnet-4-20250514", "claude-3-haiku-20240307"] },
  { provider: "openai", models: ["gpt-4o", "gpt-4o-mini"] },
  { provider: "google", models: ["gemini-2.0-flash", "gemini-1.5-flash"] },
];

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;
const RECOVERY_INTERVAL_MS = 60_000;

interface WatchdogState {
  consecutiveFailures: number;
  isDegraded: boolean;
  originalProvider: string | null;
  originalModel: string | null;
  currentProvider: string | null;
  currentModel: string | null;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  lastFailureTime: number;
}

const state: WatchdogState = {
  consecutiveFailures: 0,
  isDegraded: false,
  originalProvider: null,
  originalModel: null,
  currentProvider: null,
  currentModel: null,
  recoveryTimer: null,
  lastFailureTime: 0,
};

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("err_") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  );
}

function isRetryableStatus(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return msg.includes("429") || msg.includes("502") || msg.includes("503") || msg.includes("529");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findFallback(
  currentProvider: string,
  currentModel: string,
): { provider: string; model: string } | null {
  const providerEntry = FALLBACK_CHAIN.find(p => p.provider === currentProvider);
  if (providerEntry) {
    const altModel = providerEntry.models.find(m => m !== currentModel);
    if (altModel) return { provider: currentProvider, model: altModel };
  }

  for (const entry of FALLBACK_CHAIN) {
    if (entry.provider !== currentProvider && entry.models.length > 0) {
      return { provider: entry.provider, model: entry.models[0] };
    }
  }

  return null;
}

function startRecoveryTimer(
  onRecovery: (provider: string, model: string) => void,
): void {
  if (state.recoveryTimer) return;
  if (!state.originalProvider || !state.originalModel) return;

  const origProvider = state.originalProvider;
  const origModel = state.originalModel;

  state.recoveryTimer = setInterval(() => {
    if (!state.isDegraded) {
      if (state.recoveryTimer) {
        clearInterval(state.recoveryTimer);
        state.recoveryTimer = null;
      }
      return;
    }
    onRecovery(origProvider, origModel);
  }, RECOVERY_INTERVAL_MS);
}

export function resetWatchdog(): void {
  state.consecutiveFailures = 0;
  state.isDegraded = false;
  state.originalProvider = null;
  state.originalModel = null;
  state.currentProvider = null;
  state.currentModel = null;
  if (state.recoveryTimer) {
    clearInterval(state.recoveryTimer);
    state.recoveryTimer = null;
  }
}

export function markRecovered(): void {
  state.consecutiveFailures = 0;
  state.isDegraded = false;
  if (state.recoveryTimer) {
    clearInterval(state.recoveryTimer);
    state.recoveryTimer = null;
  }
  state.originalProvider = null;
  state.originalModel = null;
}

export function getWatchdogState(): {
  isDegraded: boolean;
  consecutiveFailures: number;
  currentProvider: string | null;
  currentModel: string | null;
} {
  return {
    isDegraded: state.isDegraded,
    consecutiveFailures: state.consecutiveFailures,
    currentProvider: state.currentProvider,
    currentModel: state.currentModel,
  };
}

export interface WatchdogConfig {
  provider: string;
  model: string;
  onDegraded?: (info: { fromProvider: string; fromModel: string; toProvider: string; toModel: string }) => void;
  onRecoveryAttempt?: (provider: string, model: string) => void;
}

/**
 * 包装一个异步 API 调用函数，加上重试 + 降级逻辑
 *
 * @param fn - 原始 API 调用（接收 provider, model 作为参数）
 * @param config - watchdog 配置
 * @returns fn 的返回值
 */
export async function watchdogWrap<T>(
  fn: (provider: string, model: string) => Promise<T>,
  config: WatchdogConfig,
): Promise<T> {
  const activeProvider = state.isDegraded && state.currentProvider ? state.currentProvider : config.provider;
  const activeModel = state.isDegraded && state.currentModel ? state.currentModel : config.model;

  // Import lazily to avoid circular deps
  const { recordAttempt } = await import("./recovery-ledger");
  const opKey = `chat:${activeProvider}:${activeModel}`;

  // Exponential backoff retry (for network errors / retryable status codes)
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await fn(activeProvider, activeModel);
      state.consecutiveFailures = 0;
      if (attempt > 0) {
        recordAttempt(opKey, "retry_with_backoff", true, `attempt ${attempt + 1}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if ((isNetworkError(err) || isRetryableStatus(err)) && attempt < MAX_RETRIES - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        recordAttempt(opKey, "retry_with_backoff", false, `attempt ${attempt + 1}, waiting ${delay}ms`);
        await sleep(delay);
        continue;
      }
      break;
    }
  }

  // 重试耗尽，累加失败计数
  state.consecutiveFailures++;
  state.lastFailureTime = Date.now();

  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !state.isDegraded) {
    const fallback = findFallback(activeProvider, activeModel);
    if (fallback) {
      state.isDegraded = true;
      state.originalProvider = config.provider;
      state.originalModel = config.model;
      state.currentProvider = fallback.provider;
      state.currentModel = fallback.model;

      config.onDegraded?.({
        fromProvider: activeProvider,
        fromModel: activeModel,
        toProvider: fallback.provider,
        toModel: fallback.model,
      });

      startRecoveryTimer((p, m) => config.onRecoveryAttempt?.(p, m));

      // Retry once with fallback config
      state.consecutiveFailures = 0;
      recordAttempt(
        opKey,
        fallback.provider !== activeProvider ? "provider_fallback" : "model_fallback",
        false,
        `${activeProvider}/${activeModel} → ${fallback.provider}/${fallback.model}`,
      );
      try {
        const result = await fn(fallback.provider, fallback.model);
        recordAttempt(
          `chat:${fallback.provider}:${fallback.model}`,
          "provider_fallback",
          true,
          "recovered",
        );
        return result;
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError;
}
