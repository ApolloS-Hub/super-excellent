import { describe, it, expect, vi } from "vitest";
import { runFork, runForks } from "../../lib/fork-dispatch";
import type { AgentConfig } from "../../lib/agent-bridge";

// Mock query-engine to simulate a successful / failed / slow fork without real API calls
vi.mock("../../lib/query-engine", () => ({
  runQuery: vi.fn(async ({ onEvent, message }: any) => {
    if (message.includes("FAIL")) throw new Error("simulated fork failure");
    if (message.includes("SLOW")) await new Promise(r => setTimeout(r, 5000));
    onEvent({ type: "text", text: `Answer to: ${message}` });
  }),
}));

const mockConfig: AgentConfig = {
  provider: "anthropic",
  apiKey: "test",
  model: "claude-sonnet-4-6",
};

describe("Fork Dispatch", () => {
  it("completes a simple fork and returns answer", async () => {
    const events: string[] = [];
    const result = await runFork({
      parentHistory: [],
      question: "what is 2+2?",
      config: mockConfig,
      onEvent: (e) => { if (e.text) events.push(e.text); },
    });
    expect(result.success).toBe(true);
    expect(result.answer).toContain("2+2");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("inherits parent history", async () => {
    const { runQuery } = await import("../../lib/query-engine");
    const parentHistory = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    await runFork({
      parentHistory,
      question: "continue",
      config: mockConfig,
      onEvent: () => {},
    });
    expect(runQuery).toHaveBeenCalledWith(
      expect.objectContaining({ history: parentHistory }),
    );
  });

  it("prefixes child events with [fork]", async () => {
    const events: string[] = [];
    await runFork({
      parentHistory: [],
      question: "hi",
      config: mockConfig,
      onEvent: (e) => { if (e.text) events.push(e.text); },
    });
    const hasForkPrefix = events.some(t => t.includes("[fork]"));
    expect(hasForkPrefix).toBe(true);
  });

  it("catches errors and returns error result", async () => {
    const result = await runFork({
      parentHistory: [],
      question: "FAIL please",
      config: mockConfig,
      onEvent: () => {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("simulated fork failure");
  });

  it("enforces depth limit", async () => {
    const result = await runFork({
      parentHistory: [],
      question: "test",
      config: mockConfig,
      onEvent: () => {},
      depth: 5,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("depth exceeded");
  });

  it("runForks executes multiple in parallel", async () => {
    const results = await runForks(
      [],
      ["Q1", "Q2", "Q3"],
      mockConfig,
      () => {},
    );
    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
  }, 15_000);
});
