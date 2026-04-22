/**
 * Observation Log tests — privacy filter + Jaccard dedup + progressive disclosure
 * (IDB-independent parts only; IDB is mocked noop in setup.ts)
 */
import { describe, it, expect } from "vitest";
import {
  stripPrivate,
  hasPrivateTag,
} from "../../lib/observation-log";

describe("observation-log: <private> tag filtering", () => {
  it("hasPrivateTag detects tagged content", () => {
    expect(hasPrivateTag("normal text <private>secret</private> more")).toBe(true);
    expect(hasPrivateTag("just plain text")).toBe(false);
  });

  it("stripPrivate replaces tagged segments with [redacted]", () => {
    const input = "public <private>private info</private> more public";
    expect(stripPrivate(input)).toBe("public [redacted] more public");
  });

  it("handles multiple private segments", () => {
    const input = "<private>a</private> and <private>b</private> stay";
    expect(stripPrivate(input)).toBe("[redacted] and [redacted] stay");
  });

  it("handles multi-line private segments", () => {
    const input = "before\n<private>\n  line 1\n  line 2\n</private>\nafter";
    const result = stripPrivate(input);
    expect(result).toContain("before");
    expect(result).toContain("after");
    expect(result).toContain("[redacted]");
    expect(result).not.toContain("line 1");
  });

  it("returns unchanged text when no tags", () => {
    const input = "no tags here, just content";
    expect(stripPrivate(input)).toBe(input);
  });

  it("is idempotent on already-redacted text", () => {
    const once = stripPrivate("plain <private>s</private> text");
    const twice = stripPrivate(once);
    expect(once).toBe(twice);
  });

  it("empty and whitespace-only content still redacts", () => {
    expect(stripPrivate("<private></private>")).toBe("[redacted]");
    expect(stripPrivate("<private>   \n\n  </private>")).toBe("[redacted]");
  });
});
