/**
 * Bounded Context tests — Garden Skills inspired
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTurn,
  getTracker,
  resetTracker,
  checkBounds,
  markSummarized,
  buildSummaryHint,
  getConfig,
  setConfig,
  checkScenarioBounds,
  MAX_SCENARIO_STEPS,
} from "../../lib/bounded-context";

beforeEach(() => {
  localStorage.clear();
});

describe("bounded-context: turn tracking", () => {
  it("recordTurn increments turn count", () => {
    const t = recordTurn("conv_1", 100, 200);
    expect(t.turnCount).toBe(1);
    recordTurn("conv_1", 50, 100);
    expect(getTracker("conv_1")!.turnCount).toBe(2);
  });

  it("estimates tokens from input+output length", () => {
    recordTurn("conv_2", 300, 600); // ~300 tokens
    const t = getTracker("conv_2")!;
    expect(t.totalTokenEstimate).toBeGreaterThan(0);
    expect(t.totalTokenEstimate).toBeLessThan(1000);
  });

  it("tracks separate conversations independently", () => {
    recordTurn("a", 100, 100);
    recordTurn("a", 100, 100);
    recordTurn("b", 100, 100);
    expect(getTracker("a")!.turnCount).toBe(2);
    expect(getTracker("b")!.turnCount).toBe(1);
  });

  it("resetTracker clears data", () => {
    recordTurn("conv_3", 100, 100);
    resetTracker("conv_3");
    expect(getTracker("conv_3")).toBeNull();
  });

  it("getTracker returns null for unknown conversations", () => {
    expect(getTracker("nonexistent")).toBeNull();
  });
});

describe("bounded-context: checkBounds", () => {
  it("no bounds hit for fresh conversation", () => {
    recordTurn("fresh", 100, 100);
    const check = checkBounds("fresh");
    expect(check.shouldSummarize).toBe(false);
  });

  it("triggers summary after maxTurnsBeforeSummary turns", () => {
    for (let i = 0; i < 16; i++) recordTurn("long", 100, 100);
    const check = checkBounds("long");
    expect(check.shouldSummarize).toBe(true);
    expect(check.reason).toContain("turns");
  });

  it("triggers summary when token estimate exceeds limit", () => {
    // Use large payloads in few turns (below the 15-turn threshold but above 50K token threshold)
    for (let i = 0; i < 10; i++) recordTurn("heavy", 10000, 10000);
    const check = checkBounds("heavy");
    expect(check.shouldSummarize).toBe(true);
    expect(check.reason).toContain("tokens");
  });

  it("does not trigger when disabled", () => {
    setConfig({ enabled: false });
    for (let i = 0; i < 20; i++) recordTurn("disabled", 100, 100);
    expect(checkBounds("disabled").shouldSummarize).toBe(false);
    setConfig({ enabled: true }); // restore
  });

  it("markSummarized resets the trigger", () => {
    for (let i = 0; i < 16; i++) recordTurn("resumm", 100, 100);
    expect(checkBounds("resumm").shouldSummarize).toBe(true);
    markSummarized("resumm");
    expect(checkBounds("resumm").shouldSummarize).toBe(false);
    // More turns → triggers again
    for (let i = 0; i < 16; i++) recordTurn("resumm", 100, 100);
    expect(checkBounds("resumm").shouldSummarize).toBe(true);
  });
});

describe("bounded-context: buildSummaryHint", () => {
  it("includes turn count and reason", () => {
    const hint = buildSummaryHint({
      shouldSummarize: true,
      reason: "15 turns since last summary",
      turnCount: 15,
      tokenEstimate: 30000,
    });
    expect(hint).toContain("15 turns");
    expect(hint).toContain("30000");
    expect(hint).toContain("summarize");
    expect(hint).toContain("accomplished");
  });
});

describe("bounded-context: config", () => {
  it("defaults to enabled with 15 turns / 50K tokens", () => {
    const cfg = getConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxTurnsBeforeSummary).toBe(15);
    expect(cfg.maxTokenEstimate).toBe(50000);
  });

  it("setConfig persists and merges", () => {
    setConfig({ maxTurnsBeforeSummary: 10 });
    const cfg = getConfig();
    expect(cfg.maxTurnsBeforeSummary).toBe(10);
    expect(cfg.enabled).toBe(true); // unchanged
  });
});

describe("bounded-context: scenario bounds", () => {
  it("allows steps within limit", () => {
    expect(checkScenarioBounds(0, 5).allowed).toBe(true);
    expect(checkScenarioBounds(4, 5).allowed).toBe(true);
  });

  it("blocks at MAX_SCENARIO_STEPS", () => {
    const result = checkScenarioBounds(MAX_SCENARIO_STEPS, 15);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("limit");
  });

  it("MAX_SCENARIO_STEPS is 10", () => {
    expect(MAX_SCENARIO_STEPS).toBe(10);
  });
});
