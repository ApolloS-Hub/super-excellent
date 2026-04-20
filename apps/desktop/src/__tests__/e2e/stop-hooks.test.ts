import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerStopHook,
  clearStopHooks,
  runStopHooks,
  initStopHooks,
} from "../../lib/stop-hooks";
import type { StopHookContext } from "../../lib/stop-hooks";

const makeCtx = (overrides?: Partial<StopHookContext>): StopHookContext => ({
  userMessage: "搜索最新的 AI 新闻",
  assistantResponse: "Here are the latest AI news...",
  turnCount: 1,
  toolsUsed: ["web_search"],
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  tokensIn: 500,
  tokensOut: 1000,
  costUsd: 0.005,
  ...overrides,
});

describe("StopHooks", () => {
  beforeEach(() => {
    clearStopHooks();
  });

  it("runs registered hooks in priority order", async () => {
    const order: string[] = [];
    registerStopHook("second", async () => {
      order.push("second");
      return { hookName: "second", success: true, durationMs: 0 };
    }, 20);
    registerStopHook("first", async () => {
      order.push("first");
      return { hookName: "first", success: true, durationMs: 0 };
    }, 10);

    await runStopHooks(makeCtx());
    expect(order).toEqual(["first", "second"]);
  });

  it("catches hook errors without crashing", async () => {
    registerStopHook("broken", async () => {
      throw new Error("hook crashed");
    });

    const results = await runStopHooks(makeCtx());
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].detail).toContain("hook crashed");
  });

  it("returns timing data for each hook", async () => {
    registerStopHook("slow", async () => {
      await new Promise(r => setTimeout(r, 50));
      return { hookName: "slow", success: true, durationMs: 50 };
    });

    const results = await runStopHooks(makeCtx());
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("initStopHooks registers built-in hooks", async () => {
    initStopHooks();
    // Should not crash even without real memory-bridge/cost-tracker
    const results = await runStopHooks(makeCtx());
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("clearStopHooks removes all hooks", async () => {
    registerStopHook("test", async () => ({ hookName: "test", success: true, durationMs: 0 }));
    clearStopHooks();
    const results = await runStopHooks(makeCtx());
    expect(results.length).toBe(0);
  });
});
