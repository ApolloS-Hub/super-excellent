import { describe, it, expect } from "vitest";
import {
  classifyError,
  shouldAutoRetry,
  shouldSwitchProvider,
  requiresUserAction,
  shouldCompactContext,
} from "../../lib/error-classifier";

describe("Typed Error Envelope", () => {
  describe("classifyError fills kind/operation/target/hint", () => {
    it("auth errors get kind=auth", () => {
      const err = classifyError({
        error: new Error("401 Unauthorized"),
        providerName: "anthropic",
        operation: "chat",
      });
      expect(err.kind).toBe("auth");
      expect(err.category).toBe("AUTH_REJECTED");
      expect(err.operation).toBe("chat");
      expect(err.hint).toBe("rotate_api_key");
    });

    it("rate limit gets kind=quota", () => {
      const err = classifyError({ error: new Error("429 rate limit"), operation: "chat" });
      expect(err.kind).toBe("quota");
      expect(err.retryable).toBe(true);
      expect(err.hint).toBe("wait_and_retry");
    });

    it("network errors get kind=network", () => {
      const err = classifyError({
        error: new Error("ECONNREFUSED"),
        baseUrl: "https://api.anthropic.com",
        operation: "chat",
      });
      expect(err.kind).toBe("network");
      expect(err.target).toBe("https://api.anthropic.com");
    });

    it("context overflow gets kind=context", () => {
      const err = classifyError({ error: new Error("context_length exceeded") });
      expect(err.kind).toBe("context");
      expect(err.hint).toBe("compact_or_new_session");
    });

    it("model not found gets kind=config", () => {
      const err = classifyError({
        error: new Error("model_not_found: gpt-99"),
        model: "gpt-99",
      });
      expect(err.kind).toBe("config");
      expect(err.hint).toBe("switch_model");
    });

    it("abort gets kind=abort, not retryable", () => {
      const err = classifyError({ error: new Error("AbortError: cancelled") });
      expect(err.kind).toBe("abort");
      expect(err.retryable).toBe(false);
    });

    it("unknown error still has kind=unknown", () => {
      const err = classifyError({ error: new Error("something weird") });
      expect(err.kind).toBe("unknown");
    });

    it("fills target from ctx.target", () => {
      const err = classifyError({
        error: new Error("timeout"),
        target: "web_search",
        operation: "tool_execute",
      });
      expect(err.target).toBe("web_search");
      expect(err.operation).toBe("tool_execute");
    });

    it("falls back to baseUrl when no explicit target", () => {
      const err = classifyError({
        error: new Error("500"),
        baseUrl: "https://api.openai.com",
      });
      expect(err.target).toBe("https://api.openai.com");
    });
  });

  describe("machine-dispatch helpers", () => {
    it("shouldAutoRetry true for quota/network/timeout", () => {
      expect(shouldAutoRetry(classifyError({ error: new Error("429") }))).toBe(true);
      expect(shouldAutoRetry(classifyError({ error: new Error("ECONNRESET") }))).toBe(true);
      expect(shouldAutoRetry(classifyError({ error: new Error("timeout") }))).toBe(true);
    });

    it("shouldAutoRetry false for auth/input/abort", () => {
      expect(shouldAutoRetry(classifyError({ error: new Error("401") }))).toBe(false);
      expect(shouldAutoRetry(classifyError({ error: new Error("invalid_request") }))).toBe(false);
      expect(shouldAutoRetry(classifyError({ error: new Error("AbortError") }))).toBe(false);
    });

    it("shouldSwitchProvider true for quota / server errors", () => {
      expect(shouldSwitchProvider(classifyError({ error: new Error("429") }))).toBe(true);
      expect(shouldSwitchProvider(classifyError({ error: new Error("503") }))).toBe(true);
    });

    it("requiresUserAction true for auth", () => {
      expect(requiresUserAction(classifyError({ error: new Error("401") }))).toBe(true);
    });

    it("requiresUserAction false for transient errors", () => {
      expect(requiresUserAction(classifyError({ error: new Error("timeout") }))).toBe(false);
    });

    it("shouldCompactContext true only for context overflow", () => {
      expect(shouldCompactContext(classifyError({ error: new Error("context_length") }))).toBe(true);
      expect(shouldCompactContext(classifyError({ error: new Error("429") }))).toBe(false);
    });
  });
});
