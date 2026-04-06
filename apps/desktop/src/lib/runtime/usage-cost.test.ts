import { beforeEach, describe, expect, it } from "vitest";
import {
  buildUsageCostSnapshot,
  clearUsageEvents,
  getBudgetLimit,
  recordUsage,
  setBudgetLimit,
} from "./usage-cost";

function makeEvent(overrides: Partial<Parameters<typeof recordUsage>[0]> = {}) {
  return {
    timestamp: new Date().toISOString(),
    sessionId: "s1",
    agentId: "developer",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    tokensIn: 500,
    tokensOut: 200,
    cost: 0.01,
    ...overrides,
  };
}

describe("usage-cost", () => {
  beforeEach(() => {
    clearUsageEvents();
    setBudgetLimit(undefined);
  });

  it("records events and builds a snapshot with periods", () => {
    recordUsage(makeEvent());
    recordUsage(makeEvent({ agentId: "growth-hacker", tokensIn: 1000, cost: 0.02 }));

    const snap = buildUsageCostSnapshot();
    expect(snap.periods).toHaveLength(3);
    const today = snap.periods.find((p) => p.key === "today");
    expect(today!.requestCount).toBe(2);
    expect(today!.tokens).toBeGreaterThan(0);
  });

  it("breaks down by agent, model, provider", () => {
    recordUsage(makeEvent({ agentId: "developer" }));
    recordUsage(makeEvent({ agentId: "developer" }));
    recordUsage(makeEvent({ agentId: "customer-support", model: "gpt-4o" }));

    const snap = buildUsageCostSnapshot();
    expect(snap.breakdown.byAgent.length).toBeGreaterThanOrEqual(2);
    const devRow = snap.breakdown.byAgent.find((r) => r.key === "developer");
    expect(devRow!.requests).toBe(2);

    expect(snap.breakdown.byModel.length).toBeGreaterThanOrEqual(1);
    expect(snap.breakdown.byProvider.length).toBeGreaterThanOrEqual(1);
  });

  it("reports budget status correctly", () => {
    setBudgetLimit(1.0);
    recordUsage(makeEvent({ cost: 0.9 }));

    const snap = buildUsageCostSnapshot();
    expect(snap.budget.status).toBe("warn");
    expect(snap.budget.limitCost30d).toBe(1.0);
  });

  it("budget over triggers over status", () => {
    setBudgetLimit(0.5);
    recordUsage(makeEvent({ cost: 0.6 }));

    const snap = buildUsageCostSnapshot();
    expect(snap.budget.status).toBe("over");
  });

  it("no budget limit reports not_connected", () => {
    recordUsage(makeEvent());
    const snap = buildUsageCostSnapshot();
    expect(snap.budget.status).toBe("not_connected");
    expect(getBudgetLimit()).toBeUndefined();
  });
});
