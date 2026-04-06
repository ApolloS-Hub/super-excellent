/**
 * API Retry — exponential backoff with jitter, 429 Retry-After awareness
 *
 * Inspired by Claude Code's withRetry pattern.
 * Zero external dependencies.
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

export type ErrorCategory = "retryable" | "non_retryable" | "rate_limited";

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatuses: [429, 500, 502, 503],
};

export function categorizeError(error: Error | Response): ErrorCategory {
  if (error instanceof Response) {
    if (error.status === 429) return "rate_limited";
    if (DEFAULT_CONFIG.retryableStatuses.includes(error.status)) return "retryable";
    return "non_retryable";
  }

  const msg = error.message.toLowerCase();

  if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("429")) {
    return "rate_limited";
  }

  if (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503")
  ) {
    return "retryable";
  }

  return "non_retryable";
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

function computeDelay(attempt: number, config: RetryConfig, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, config.maxDelayMs);
  }

  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * 0.5 * Math.random();
  return Math.min(exponential + jitter, config.maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config?: Partial<RetryConfig>,
): Promise<Response> {
  const cfg: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      const category = categorizeError(response);

      if (category === "non_retryable" || attempt >= cfg.maxRetries) {
        return response;
      }

      const retryAfterMs = category === "rate_limited" ? parseRetryAfter(response) : null;
      const delayMs = computeDelay(attempt, cfg, retryAfterMs);

      await sleep(delayMs, options.signal as AbortSignal | undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      const category = categorizeError(lastError);

      if (category === "non_retryable" || attempt >= cfg.maxRetries) {
        throw lastError;
      }

      const delayMs = computeDelay(attempt, cfg, null);
      await sleep(delayMs, options.signal as AbortSignal | undefined);
    }
  }

  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}
