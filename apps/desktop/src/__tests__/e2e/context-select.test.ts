import { describe, it, expect, vi } from "vitest";
import {
  createContextCache,
  loadFileMetadata,
  loadFileSummary,
  summarizeFileContent,
} from "../../lib/context-select";

describe("Context Select (JIT loading)", () => {
  it("memoizes loads within a cache", async () => {
    const cache = createContextCache();
    const loader = vi.fn(async () => "file content");
    await cache.load("key1", loader);
    await cache.load("key1", loader);
    await cache.load("key1", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent loads of the same key", async () => {
    const cache = createContextCache();
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 20));
      return "content";
    };
    await Promise.all([
      cache.load("same", loader),
      cache.load("same", loader),
      cache.load("same", loader),
    ]);
    expect(calls).toBe(1);
  });

  it("loads different keys independently", async () => {
    const cache = createContextCache();
    const a = await cache.load("a", async () => "A");
    const b = await cache.load("b", async () => "B");
    expect(a).toBe("A");
    expect(b).toBe("B");
  });

  it("has() reports cached keys", async () => {
    const cache = createContextCache();
    expect(cache.has("k")).toBe(false);
    await cache.load("k", async () => "v");
    expect(cache.has("k")).toBe(true);
  });

  it("invalidate() evicts a specific entry", async () => {
    const cache = createContextCache();
    await cache.load("k", async () => "v1");
    cache.invalidate("k");
    const loader = vi.fn(async () => "v2");
    const result = await cache.load("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toBe("v2");
  });

  it("release() clears all entries", async () => {
    const cache = createContextCache();
    await cache.load("a", async () => "A");
    await cache.load("b", async () => "B");
    cache.release();
    expect(cache.entries().length).toBe(0);
  });

  it("totalSize sums entry sizes", async () => {
    const cache = createContextCache();
    await cache.load("a", async () => "ABC");
    await cache.load("b", async () => "DEFGH");
    expect(cache.totalSize()).toBe(3 + 5);
  });

  it("propagates loader errors and doesn't cache them", async () => {
    const cache = createContextCache();
    await expect(cache.load("bad", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    // Next call should attempt again
    const result = await cache.load("bad", async () => "recovered");
    expect(result).toBe("recovered");
  });
});

describe("summarizeFileContent", () => {
  it("extracts TS imports and functions", () => {
    const code = `
import { foo } from "./bar";
import * as z from "zod";

export function add(a: number, b: number): number {
  return a + b;
}

function helper() { return 42; }

export class Widget { }
`;
    const summary = summarizeFileContent(code);
    expect(summary).toContain("Imports:");
    expect(summary).toContain("Functions:");
    expect(summary).toContain("add");
    expect(summary).toContain("class Widget");
  });

  it("reports line count", () => {
    const code = "line1\nline2\nline3";
    const summary = summarizeFileContent(code);
    expect(summary).toContain("3 lines");
  });
});

describe("Three-tier disclosure helpers", () => {
  it("loadFileMetadata returns preview + size", async () => {
    const cache = createContextCache();
    const result = await loadFileMetadata(cache, "/tmp/foo.ts",
      async () => "line1\nline2\nline3\nline4");
    expect(result.size).toBeGreaterThan(0);
    expect(result.preview).toContain("line1");
    expect(result.path).toBe("/tmp/foo.ts");
  });

  it("loadFileSummary returns extracted structure", async () => {
    const cache = createContextCache();
    const result = await loadFileSummary(cache, "/tmp/src.ts",
      async () => `import foo from "foo";\nexport function bar() {}`);
    expect(result.summary).toContain("Imports");
    expect(result.summary).toContain("bar");
  });

  it("different tiers cache separately", async () => {
    const cache = createContextCache();
    const fetchFn = vi.fn(async () => "export function foo() {}");
    await loadFileMetadata(cache, "/a", fetchFn);
    await loadFileSummary(cache, "/a", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2); // metadata:/a and summary:/a
  });
});
