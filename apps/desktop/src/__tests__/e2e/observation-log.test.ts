/**
 * Observation Log tests — privacy filter + Jaccard dedup + progressive disclosure
 * (IDB-independent parts only; IDB is mocked noop in setup.ts)
 */
import { describe, it, expect } from "vitest";
import {
  stripPrivate,
  hasPrivateTag,
  extractLinks,
  getBacklinks,
  getForwardLinks,
  getAllLinked,
  type Observation,
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

// ═══════════ Bidirectional links ═══════════

describe("observation-log: extractLinks", () => {
  it("extracts [[obs_id]] references from text", () => {
    const links = extractLinks("Based on [[obs_123_abc]] and [[obs_456_def]], we decided...");
    expect(links).toEqual(["obs_123_abc", "obs_456_def"]);
  });

  it("returns empty array when no links", () => {
    expect(extractLinks("no links here")).toEqual([]);
  });

  it("deduplicates repeated references", () => {
    const links = extractLinks("see [[obs_1_a]] and again [[obs_1_a]] for context");
    expect(links).toEqual(["obs_1_a"]);
  });

  it("only matches obs_ prefixed IDs", () => {
    const links = extractLinks("[[random_text]] and [[obs_valid_123]]");
    expect(links).toEqual(["obs_valid_123"]);
  });

  it("handles IDs with underscores and alphanumeric chars", () => {
    const links = extractLinks("ref [[obs_1234567890_abcdef]]");
    expect(links).toEqual(["obs_1234567890_abcdef"]);
  });
});

describe("observation-log: getForwardLinks", () => {
  it("returns links array from observation", () => {
    const obs: Observation = {
      id: "obs_a", timestamp: 1, type: "decision", summary: "s",
      detail: "d", tags: [], accessCount: 0, links: ["obs_b", "obs_c"],
    };
    expect(getForwardLinks(obs)).toEqual(["obs_b", "obs_c"]);
  });

  it("returns empty array when no links", () => {
    const obs: Observation = {
      id: "obs_x", timestamp: 1, type: "decision", summary: "s",
      detail: "d", tags: [], accessCount: 0, links: [],
    };
    expect(getForwardLinks(obs)).toEqual([]);
  });
});

describe("observation-log: getAllLinked", () => {
  const makeObs = (id: string, links: string[] = []): Observation => ({
    id, timestamp: Date.now(), type: "decision", summary: id,
    detail: `detail for ${id}`, tags: [], accessCount: 0, links,
  });

  it("returns forward-linked observations", () => {
    const a = makeObs("obs_a", ["obs_b"]);
    const b = makeObs("obs_b");
    const c = makeObs("obs_c");
    const related = getAllLinked("obs_a", [a, b, c]);
    expect(related.map(o => o.id)).toContain("obs_b");
    expect(related.map(o => o.id)).not.toContain("obs_c");
  });

  it("does not include self in results", () => {
    const a = makeObs("obs_a", ["obs_a"]);
    const related = getAllLinked("obs_a", [a]);
    expect(related.length).toBe(0);
  });

  it("returns empty for observation with no links and no backlinks", () => {
    const a = makeObs("obs_a");
    const b = makeObs("obs_b");
    const related = getAllLinked("obs_a", [a, b]);
    expect(related.length).toBe(0);
  });
});
