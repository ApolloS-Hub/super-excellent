import { describe, it, expect } from "vitest";
import { ShortTermMemory } from "../src/memory/short-term.js";
import { MemoryManager } from "../src/memory/index.js";
import { PromptCacheManager } from "../src/cache/prompt-cache.js";

describe("ShortTermMemory", () => {
  it("should store and retrieve entries", async () => {
    const mem = new ShortTermMemory();
    await mem.store("test1", "Hello world, this is a test about TypeScript");
    await mem.store("test2", "Python is great for data science");

    const results = await mem.retrieve("TypeScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should return recent entries", async () => {
    const mem = new ShortTermMemory();
    await mem.store("a", "first");
    await mem.store("b", "second");
    await mem.store("c", "third");

    const recent = mem.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("second");
    expect(recent[1].content).toBe("third");
  });

  it("should auto-compact when over threshold", async () => {
    const mem = new ShortTermMemory(15); // Low threshold
    for (let i = 0; i < 20; i++) {
      await mem.store(`entry-${i}`, `Content number ${i}`);
    }
    // After compaction, should be ~11 (1 summary + 10 kept)
    const all = mem.getAll();
    expect(all.length).toBeLessThanOrEqual(15);
    expect(all[0].metadata?.compacted).toBe(true);
  });

  it("should clear all entries", async () => {
    const mem = new ShortTermMemory();
    await mem.store("test", "data");
    await mem.clear();
    expect(mem.getAll()).toHaveLength(0);
  });
});

describe("PromptCacheManager", () => {
  it("should estimate tokens", () => {
    const cache = new PromptCacheManager();
    const english = cache.estimateTokens("Hello world");
    expect(english).toBeGreaterThan(0);
    expect(english).toBeLessThan(10);

    const chinese = cache.estimateTokens("你好世界");
    expect(chinese).toBeGreaterThan(0);
  });

  it("should detect when compaction needed", () => {
    const cache = new PromptCacheManager({ maxContextTokens: 1000, compactThresholdPercent: 80 });
    expect(cache.shouldCompact(500)).toBe(false);
    expect(cache.shouldCompact(900)).toBe(true);
  });

  it("should micro-compact long tool results", () => {
    const cache = new PromptCacheManager({ maxToolResultTokens: 10 });
    const longResult = "a".repeat(1000);
    const compacted = cache.microCompact(longResult);
    expect(compacted.length).toBeLessThan(longResult.length);
    expect(compacted).toContain("truncated");
  });

  it("should build optimized system prompt", () => {
    const cache = new PromptCacheManager();
    const prompt = cache.buildSystemPrompt({
      base: "You are an AI assistant.",
      tools: "Tool list here",
      memory: "User prefers concise answers",
    });
    expect(prompt).toContain("AI assistant");
    expect(prompt).toContain("Tool list");
    expect(prompt).toContain("concise answers");
  });
});

describe("MemoryManager", () => {
  it("should create with default config", () => {
    const mm = new MemoryManager();
    expect(mm.shortTerm).toBeDefined();
    expect(mm.midTerm).toBeDefined();
    expect(mm.longTerm).toBeDefined();
  });

  it("should process conversation turns", async () => {
    const mm = new MemoryManager({ storageDir: "/tmp/se-test-mem" });
    await mm.processConversationTurn("What is TypeScript?", "TypeScript is a typed superset of JavaScript.");
    
    const recent = mm.shortTerm.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].content).toContain("TypeScript");
  });
});
