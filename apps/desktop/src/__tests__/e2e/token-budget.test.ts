import { describe, it, expect, beforeEach } from "vitest";
import {
  initBudget,
  recordTurnUsage,
  isBudgetExceeded,
  getSessionBudget,
  getContextWindow,
  estimateCost,
  estimateTokens,
  shouldCompact,
  formatCost,
  formatTokens,
  getRemainingContextTokens,
} from "../../lib/token-budget";

describe("TokenBudget", () => {
  beforeEach(() => {
    initBudget("claude-sonnet-4-6");
  });

  describe("initBudget", () => {
    it("sets context window from model", () => {
      initBudget("claude-sonnet-4-6");
      expect(getSessionBudget().contextWindowSize).toBe(200000);
    });

    it("defaults to 128K for unknown models", () => {
      initBudget("unknown-model-xyz");
      expect(getSessionBudget().contextWindowSize).toBe(128000);
    });

    it("resets totals", () => {
      recordTurnUsage({ inputTokens: 1000, outputTokens: 500 });
      initBudget();
      expect(getSessionBudget().totalInputTokens).toBe(0);
    });
  });

  describe("recordTurnUsage", () => {
    it("accumulates tokens across turns", () => {
      recordTurnUsage({ inputTokens: 1000, outputTokens: 500 });
      recordTurnUsage({ inputTokens: 2000, outputTokens: 800 });
      const budget = getSessionBudget();
      expect(budget.totalInputTokens).toBe(3000);
      expect(budget.totalOutputTokens).toBe(1300);
      expect(budget.turnCount).toBe(2);
    });

    it("returns snapshot with compact decision", () => {
      const snap = recordTurnUsage({ inputTokens: 170000 }, "claude-sonnet-4-6");
      expect(snap.contextWindowUsedPercent).toBe(85);
      expect(snap.shouldCompact).toBe(true);
    });

    it("estimates cost", () => {
      const snap = recordTurnUsage(
        { inputTokens: 1000, outputTokens: 500 },
        "claude-sonnet-4-6",
      );
      expect(snap.estimatedCost).toBeGreaterThan(0);
    });
  });

  describe("isBudgetExceeded", () => {
    it("returns false when no budget set", () => {
      initBudget("claude-sonnet-4-6", 0);
      recordTurnUsage({ inputTokens: 999999, outputTokens: 999999 });
      expect(isBudgetExceeded()).toBe(false);
    });

    it("returns true when cost exceeds max", () => {
      initBudget("claude-sonnet-4-6", 0.001);
      recordTurnUsage({ inputTokens: 100000, outputTokens: 50000 }, "claude-sonnet-4-6");
      expect(isBudgetExceeded()).toBe(true);
    });
  });

  describe("estimateTokens", () => {
    it("estimates English text", () => {
      const tokens = estimateTokens("Hello, this is a test message for token estimation.");
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(30);
    });

    it("estimates CJK text (more tokens per char)", () => {
      const en = estimateTokens("Hello world");
      const zh = estimateTokens("你好世界测试");
      expect(zh).toBeGreaterThan(en * 0.5);
    });
  });

  describe("shouldCompact", () => {
    it("returns false below threshold", () => {
      expect(shouldCompact(50000)).toBe(false);
    });

    it("returns true above 80% threshold", () => {
      expect(shouldCompact(170000)).toBe(true);
    });
  });

  describe("formatting", () => {
    it("formatCost handles tiny amounts", () => {
      expect(formatCost(0.0001)).toBe("$0.000100");
    });

    it("formatCost handles normal amounts", () => {
      expect(formatCost(1.23)).toBe("$1.23");
    });

    it("formatTokens handles K", () => {
      expect(formatTokens(1500)).toBe("1.5K");
    });

    it("formatTokens handles M", () => {
      expect(formatTokens(1500000)).toBe("1.5M");
    });

    it("formatTokens handles small numbers", () => {
      expect(formatTokens(42)).toBe("42");
    });
  });

  describe("getContextWindow", () => {
    it("finds Claude models", () => {
      expect(getContextWindow("claude-sonnet-4-6")).toBe(200000);
    });

    it("finds GPT models", () => {
      expect(getContextWindow("gpt-4o-mini")).toBe(128000);
    });

    it("finds Kimi models", () => {
      expect(getContextWindow("moonshot-v1-128k")).toBe(128000);
    });
  });
});
