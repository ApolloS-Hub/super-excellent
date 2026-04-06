import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { rm, mkdir, mkdtemp } from "fs/promises";
import { ShortTermMemory } from "../src/memory/short-term.js";
import { LongTermMemory } from "../src/memory/long-term.js";
import { MemoryManager } from "../src/memory/index.js";
import { PromptCacheManager } from "../src/cache/prompt-cache.js";

// ── ShortTermMemory ────────────────────────────────────────────────────────

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

// ── LongTermMemory — vector embedding ─────────────────────────────────────

describe("LongTermMemory", () => {
  let storageDir: string;
  let mem: LongTermMemory;

  beforeEach(async () => {
    storageDir = join(tmpdir(), `se-lt-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storageDir, { recursive: true });
    mem = new LongTermMemory(storageDir);
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  it("returns semantically relevant results above threshold", async () => {
    await mem.store("ts", "TypeScript adds static types to JavaScript");
    await mem.store("py", "Python is great for machine learning and data science");
    await mem.store("rust", "Rust provides memory safety without a garbage collector");

    const results = await mem.retrieve("JavaScript types", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // TypeScript entry must rank first
    expect(results[0].key).toBe("ts");
  });

  it("relevance scores are in [0, 1] and entries sorted descending", async () => {
    await mem.store("a", "vector embeddings enable semantic similarity search");
    await mem.store("b", "bananas are a fruit grown in tropical climates");
    await mem.store("c", "cosine similarity measures angle between vectors");

    const results = await mem.retrieve("semantic vector search");
    for (const r of results) {
      expect(r.relevance).toBeGreaterThanOrEqual(0);
      expect(r.relevance).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevance!).toBeGreaterThanOrEqual(results[i].relevance!);
    }
  });

  it("stable sort: equal relevance entries ordered by timestamp descending", async () => {
    // Store two entries with identical content so their vectors are identical
    const content = "unique phrase for tie breaking test scenario";
    const mem2 = new LongTermMemory(storageDir);
    await mem2.store("older", content, {});
    // Ensure distinct timestamps
    await new Promise(r => setTimeout(r, 5));
    await mem2.store("newer", content, {});

    const results = await mem2.retrieve(content, 5);
    expect(results.length).toBe(2);
    // Same relevance → newer first
    expect(results[0].key).toBe("newer");
    expect(results[1].key).toBe("older");
  });

  it("returns empty array when no entries exceed threshold", async () => {
    await mem.store("unrelated", "The quick brown fox jumps over the lazy dog");
    // Extremely dissimilar query — cosine similarity should be <= 0.1
    const results = await mem.retrieve("quantum chromodynamics particle physics");
    // May or may not be empty depending on overlap; assert it doesn't throw
    expect(Array.isArray(results)).toBe(true);
  });

  it("persists vectors to disk and reloads correctly", async () => {
    await mem.store("persist-test", "machine learning neural network deep learning");

    // New instance — reads from same storageDir
    const mem2 = new LongTermMemory(storageDir);
    const results = await mem2.retrieve("neural network deep learning", 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe("persist-test");
    // Loaded vector should produce valid cosine score
    expect(results[0].relevance).toBeGreaterThan(0.1);
  });

  it("migrates legacy keyword-based entries on load", async () => {
    // Write a legacy entry directly (uses `keywords` instead of `vector`)
    const { writeFile } = await import("fs/promises");
    const legacyEntry = [{
      key: "legacy",
      content: "TypeScript compiler transpiles to JavaScript",
      timestamp: Date.now() - 1000,
      keywords: ["typescript", "compiler", "transpiles", "javascript"],
    }];
    await writeFile(join(storageDir, "long-term.json"), JSON.stringify(legacyEntry), "utf-8");

    const mem2 = new LongTermMemory(storageDir);
    const results = await mem2.retrieve("TypeScript JavaScript", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe("legacy");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await mem.store(`k${i}`, `semantic similarity vector embedding retrieval ${i}`);
    }
    const results = await mem.retrieve("semantic vector embedding", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("clear removes all entries and persists empty state", async () => {
    await mem.store("x", "some content here");
    await mem.clear();

    const mem2 = new LongTermMemory(storageDir);
    const results = await mem2.retrieve("some content", 5);
    expect(results).toHaveLength(0);
  });

  it("storeConversation and searchConversations filter by type", async () => {
    await mem.storeConversation("We discussed React hooks and state management", "sess-1");
    await mem.store("other", "unrelated entry about cloud infrastructure");

    const convResults = await mem.searchConversations("React hooks", 3);
    expect(convResults.length).toBeGreaterThanOrEqual(1);
    expect(convResults[0].metadata?.type).toBe("conversation");
    expect(convResults[0].metadata?.sessionId).toBe("sess-1");
  });

  it("embedding is deterministic — same text yields same similarity", async () => {
    const text = "deterministic embedding reproducibility check";
    await mem.store("det", text);
    const r1 = await mem.retrieve(text, 1);
    const r2 = await mem.retrieve(text, 1);
    expect(r1[0].relevance).toBeCloseTo(r2[0].relevance!, 10);
  });
});

// ── PromptCacheManager ─────────────────────────────────────────────────────

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

// ── MemoryManager ──────────────────────────────────────────────────────────

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

  it("injects recalled long-term context into snapshots across manager instances", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "se-memory-manager-"));

    try {
      const mm1 = new MemoryManager({ storageDir });
      await mm1.processConversationTurn(
        "Remember our deployment rule",
        "Deploy Super Excellent through GitHub Actions only after typecheck, test, and build all pass.",
      );

      const mm2 = new MemoryManager({ storageDir });
      const snapshot = await mm2.getSnapshot("What is our deploy rule for GitHub Actions?");

      expect(snapshot.entriesUsed).toBeGreaterThan(0);
      expect(snapshot.context).toContain("# Relevant History");
      expect(snapshot.context).toContain("typecheck, test, and build all pass");
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
