import { describe, it, expect, beforeEach } from "vitest";
import {
  recordAttempt,
  getAttempts,
  hasTriedRecently,
  attemptCount,
  summarize,
  clearLedger,
  enrichErrorWithHistory,
} from "../../lib/recovery-ledger";
import { classifyError } from "../../lib/error-classifier";

describe("Recovery Ledger", () => {
  beforeEach(() => {
    clearLedger();
  });

  it("records an attempt", () => {
    recordAttempt("chat:anthropic:claude-sonnet", "retry", true, "attempt 1");
    const attempts = getAttempts("chat:anthropic:claude-sonnet");
    expect(attempts.length).toBe(1);
    expect(attempts[0].strategy).toBe("retry");
    expect(attempts[0].succeeded).toBe(true);
  });

  it("separates by operation key", () => {
    recordAttempt("op1", "retry", true);
    recordAttempt("op2", "provider_fallback", false);
    expect(getAttempts("op1").length).toBe(1);
    expect(getAttempts("op2").length).toBe(1);
    expect(attemptCount("op1")).toBe(1);
  });

  it("hasTriedRecently detects failed attempts", () => {
    recordAttempt("op", "retry", false);
    expect(hasTriedRecently("op", "retry")).toBe(true);
    expect(hasTriedRecently("op", "provider_fallback")).toBe(false);
  });

  it("summarize produces human-readable text", () => {
    recordAttempt("op", "retry_with_backoff", false);
    recordAttempt("op", "retry_with_backoff", false);
    recordAttempt("op", "provider_fallback", true);
    const summary = summarize("op");
    expect(summary).toContain("retry_with_backoff");
    expect(summary).toContain("2x");
    expect(summary).toContain("provider_fallback");
  });

  it("enrichErrorWithHistory adds history to error details", () => {
    recordAttempt("op", "retry", false);
    recordAttempt("op", "provider_fallback", false);
    const err = classifyError({ error: new Error("timeout") });
    const enriched = enrichErrorWithHistory(err, "op");
    expect(enriched.details).toContain("Attempted:");
    expect(enriched.details).toContain("retry");
  });

  it("clearLedger empties everything", () => {
    recordAttempt("op1", "retry", true);
    recordAttempt("op2", "reset", false);
    clearLedger();
    expect(getAttempts("op1").length).toBe(0);
    expect(getAttempts("op2").length).toBe(0);
  });
});
