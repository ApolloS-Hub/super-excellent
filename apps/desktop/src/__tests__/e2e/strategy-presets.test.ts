/**
 * Strategy Presets + Stagnation Detection tests (Evolver-inspired)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getStrategy,
  setStrategy,
  loadStrategy,
  getPresetNames,
  getPresetDescription,
  recordFailure,
  isStagnant,
  getFailureCount,
  clearFailures,
  clearAllFailures,
  suggestAlternativeWorker,
  initStrategy,
} from "../../lib/strategy-presets";

describe("strategy-presets: presets", () => {
  beforeEach(() => {
    localStorage.clear();
    initStrategy();
  });

  it("defaults to balanced", () => {
    expect(getStrategy().preset).toBe("balanced");
  });

  it("getPresetNames returns all 4 presets", () => {
    const names = getPresetNames();
    expect(names).toEqual(["balanced", "innovate", "harden", "repair"]);
  });

  it("setStrategy switches and persists", () => {
    setStrategy("innovate");
    expect(getStrategy().preset).toBe("innovate");
    expect(localStorage.getItem("strategy-preset")).toBe("innovate");
  });

  it("loadStrategy restores from localStorage", () => {
    localStorage.setItem("strategy-preset", "harden");
    const cfg = loadStrategy();
    expect(cfg.preset).toBe("harden");
  });

  it("innovate preset is lenient: low threshold, 0 retries", () => {
    setStrategy("innovate");
    const cfg = getStrategy();
    expect(cfg.qualityGateThreshold).toBeLessThan(0.5);
    expect(cfg.maxRetries).toBe(0);
    expect(cfg.skipOptionalSteps).toBe(true);
    expect(cfg.creativityBias).toBeGreaterThan(0.7);
  });

  it("harden preset is strict: high threshold, 2 retries, senior workers", () => {
    setStrategy("harden");
    const cfg = getStrategy();
    expect(cfg.qualityGateThreshold).toBeGreaterThan(0.7);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.preferSeniorWorkers).toBe(true);
    expect(cfg.creativityBias).toBeLessThan(0.4);
  });

  it("repair preset is conservative: skip optional, low creativity", () => {
    setStrategy("repair");
    const cfg = getStrategy();
    expect(cfg.skipOptionalSteps).toBe(true);
    expect(cfg.creativityBias).toBeLessThan(0.2);
    expect(cfg.preferSeniorWorkers).toBe(true);
  });

  it("getPresetDescription returns non-empty descriptions", () => {
    for (const p of getPresetNames()) {
      expect(getPresetDescription(p).length).toBeGreaterThan(10);
    }
  });

  it("invalid localStorage value falls back to balanced", () => {
    localStorage.setItem("strategy-preset", "nonexistent");
    const cfg = loadStrategy();
    expect(cfg.preset).toBe("balanced");
  });
});

describe("strategy-presets: stagnation detection", () => {
  beforeEach(() => {
    clearAllFailures();
  });

  it("no failures → not stagnant", () => {
    expect(isStagnant("developer")).toBe(false);
    expect(getFailureCount("developer")).toBe(0);
  });

  it("1-2 failures → not stagnant yet", () => {
    recordFailure("developer", "not_empty");
    recordFailure("developer", "not_empty");
    expect(isStagnant("developer")).toBe(false);
    expect(getFailureCount("developer")).toBe(2);
  });

  it("3+ failures within window → stagnant", () => {
    recordFailure("developer", "check_a");
    recordFailure("developer", "check_a");
    recordFailure("developer", "check_a");
    expect(isStagnant("developer")).toBe(true);
    expect(getFailureCount("developer")).toBe(3);
  });

  it("clearFailures resets count for a specific worker", () => {
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    expect(isStagnant("developer")).toBe(true);
    clearFailures("developer");
    expect(isStagnant("developer")).toBe(false);
    expect(getFailureCount("developer")).toBe(0);
  });

  it("clearAllFailures resets all workers", () => {
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    recordFailure("writer", "y");
    recordFailure("writer", "y");
    recordFailure("writer", "y");
    clearAllFailures();
    expect(isStagnant("developer")).toBe(false);
    expect(isStagnant("writer")).toBe(false);
  });

  it("failures for different workers are independent", () => {
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    recordFailure("developer", "x");
    recordFailure("writer", "y");
    expect(isStagnant("developer")).toBe(true);
    expect(isStagnant("writer")).toBe(false);
  });
});

describe("strategy-presets: suggestAlternativeWorker", () => {
  beforeEach(() => {
    clearAllFailures();
  });

  it("suggests a fallback for developer → frontend or architect", () => {
    const alt = suggestAlternativeWorker("developer");
    expect(alt).not.toBeNull();
    expect(["frontend", "architect"]).toContain(alt);
  });

  it("suggests a fallback for writer → content_ops or product", () => {
    const alt = suggestAlternativeWorker("writer");
    expect(alt).not.toBeNull();
    expect(["content_ops", "product"]).toContain(alt);
  });

  it("skips stagnant fallbacks and returns first non-stagnant", () => {
    // Make 'frontend' stagnant
    recordFailure("frontend", "x");
    recordFailure("frontend", "x");
    recordFailure("frontend", "x");
    const alt = suggestAlternativeWorker("developer");
    expect(alt).toBe("architect"); // frontend is stagnant, so architect
  });

  it("returns null if all fallbacks are stagnant", () => {
    recordFailure("frontend", "x");
    recordFailure("frontend", "x");
    recordFailure("frontend", "x");
    recordFailure("architect", "y");
    recordFailure("architect", "y");
    recordFailure("architect", "y");
    const alt = suggestAlternativeWorker("developer");
    expect(alt).toBeNull();
  });

  it("returns null for unknown worker with no fallback map", () => {
    expect(suggestAlternativeWorker("nonexistent_role")).toBeNull();
  });
});
