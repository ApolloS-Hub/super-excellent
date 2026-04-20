/**
 * Recovery Ledger — tracks auto-recovery attempts so escalation is informed.
 *
 * Inspired by claw-code's philosophy: "Recovery Before Escalation".
 * When the system surfaces an error to the user, the user should see:
 *   "Failed after trying: retry (2x), provider fallback (anthropic→openai), reset"
 * instead of a bare error message.
 *
 * Each worker/operation accumulates a small history of recovery attempts.
 * Entries auto-expire after 5 minutes so we don't grow unbounded.
 */

import type { ClassifiedError } from "./error-classifier";

export type RecoveryStrategy =
  | "retry"              // same call, after backoff
  | "retry_with_backoff" // same call with exponential backoff
  | "provider_fallback"  // switched provider (anthropic → openai)
  | "model_fallback"     // switched to smaller/different model
  | "tool_fallback"      // switched tool path (Rust → browser fetch)
  | "context_compact"    // compressed context and retried
  | "reset"              // reset session state
  | "human_approval";    // required user approval to proceed

export interface RecoveryAttempt {
  timestamp: number;
  operation: string;
  strategy: RecoveryStrategy;
  succeeded: boolean;
  detail?: string;
  /** Error kind that triggered the attempt */
  triggeredBy?: string;
}

const MAX_ENTRIES_PER_OP = 20;
const ENTRY_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ledger = new Map<string, RecoveryAttempt[]>();

/**
 * Record a recovery attempt for an operation.
 */
export function recordAttempt(
  operation: string,
  strategy: RecoveryStrategy,
  succeeded: boolean,
  detail?: string,
  triggeredBy?: string,
): void {
  const entries = ledger.get(operation) ?? [];
  entries.push({
    timestamp: Date.now(),
    operation,
    strategy,
    succeeded,
    detail,
    triggeredBy,
  });

  // Trim and expire
  const cutoff = Date.now() - ENTRY_TTL_MS;
  const fresh = entries.filter(e => e.timestamp > cutoff).slice(-MAX_ENTRIES_PER_OP);
  ledger.set(operation, fresh);
}

/**
 * Get all recovery attempts for an operation (fresh entries only).
 */
export function getAttempts(operation: string): RecoveryAttempt[] {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  const entries = ledger.get(operation) ?? [];
  return entries.filter(e => e.timestamp > cutoff);
}

/**
 * Has a given strategy already been tried (and failed) for this operation recently?
 * Useful for avoiding retry loops.
 */
export function hasTriedRecently(operation: string, strategy: RecoveryStrategy): boolean {
  return getAttempts(operation).some(e => e.strategy === strategy && !e.succeeded);
}

/**
 * Count of recent attempts for this operation.
 */
export function attemptCount(operation: string): number {
  return getAttempts(operation).length;
}

/**
 * Human-readable summary of what was tried before escalating to the user.
 * Used in error messages: "Failed after 3 attempts: retry, provider fallback, reset"
 */
export function summarize(operation: string): string {
  const attempts = getAttempts(operation);
  if (attempts.length === 0) return "";

  const byStrategy = new Map<RecoveryStrategy, { count: number; succeeded: boolean }>();
  for (const a of attempts) {
    const prev = byStrategy.get(a.strategy);
    if (prev) {
      prev.count++;
      if (a.succeeded) prev.succeeded = true;
    } else {
      byStrategy.set(a.strategy, { count: 1, succeeded: a.succeeded });
    }
  }

  const parts: string[] = [];
  for (const [strategy, info] of byStrategy.entries()) {
    const count = info.count > 1 ? ` (${info.count}x)` : "";
    const icon = info.succeeded ? "✓" : "✗";
    parts.push(`${icon} ${strategy}${count}`);
  }
  return parts.join(", ");
}

/**
 * Clear the ledger (for testing, or new session).
 */
export function clearLedger(): void {
  ledger.clear();
}

/**
 * Get ledger snapshot for debugging/observability.
 */
export function getLedgerSnapshot(): Record<string, RecoveryAttempt[]> {
  const snapshot: Record<string, RecoveryAttempt[]> = {};
  for (const op of ledger.keys()) {
    snapshot[op] = getAttempts(op);
  }
  return snapshot;
}

/**
 * Decorate an error with recovery history so the user sees what was tried.
 */
export function enrichErrorWithHistory(err: ClassifiedError, operation: string): ClassifiedError {
  const summary = summarize(operation);
  if (!summary) return err;
  return {
    ...err,
    details: err.details
      ? `${err.details}\n\nAttempted: ${summary}`
      : `Attempted: ${summary}`,
  };
}
