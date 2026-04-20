/**
 * Context Select — just-in-time context loading with memoization.
 *
 * Inspired by keli-wen/agentic-harness-patterns (Context Engineering / Select):
 *   - Promise memoization: don't fetch the same file twice in a turn
 *   - Three-tier progressive disclosure: metadata → summary → full content
 *   - Manual invalidation: release on turn end
 *
 * Use cases:
 *   - A file is referenced multiple times in a single turn — fetch once
 *   - Large files should be summarized first, full content only if needed
 *   - Per-turn cache prevents stale data across turns
 */

export type DisclosureTier = "metadata" | "summary" | "full";

export interface ContextEntry<T = unknown> {
  key: string;
  tier: DisclosureTier;
  value: T;
  loadedAt: number;
  /** Size estimate in chars */
  size: number;
}

type Loader<T> = () => Promise<T>;

/**
 * A per-turn context cache. Created by `createContextCache()` at the start
 * of a query, released via `release()` at the end.
 */
export interface ContextCache {
  /** Load a value, memoized across the lifetime of this cache. */
  load<T>(key: string, loader: Loader<T>, tier?: DisclosureTier): Promise<T>;
  /** Has a value been loaded under this key? */
  has(key: string): boolean;
  /** Evict a specific entry */
  invalidate(key: string): void;
  /** Get all entries (for debugging / telemetry) */
  entries(): ContextEntry[];
  /** Current total size across all entries */
  totalSize(): number;
  /** Release all entries */
  release(): void;
}

export function createContextCache(): ContextCache {
  const store = new Map<string, ContextEntry>();
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    async load<T>(key: string, loader: Loader<T>, tier: DisclosureTier = "full"): Promise<T> {
      // Already cached
      const existing = store.get(key);
      if (existing) return existing.value as T;

      // In flight — reuse the same promise (dedupe concurrent calls)
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;

      const promise = loader().then(value => {
        const size = typeof value === "string"
          ? value.length
          : JSON.stringify(value ?? "").length;
        store.set(key, {
          key,
          tier,
          value,
          loadedAt: Date.now(),
          size,
        });
        inFlight.delete(key);
        return value;
      }).catch(err => {
        inFlight.delete(key);
        throw err;
      });

      inFlight.set(key, promise as Promise<unknown>);
      return promise;
    },

    has(key) { return store.has(key); },
    invalidate(key) { store.delete(key); },
    entries() { return Array.from(store.values()); },
    totalSize() {
      let total = 0;
      for (const entry of store.values()) total += entry.size;
      return total;
    },
    release() {
      store.clear();
      inFlight.clear();
    },
  };
}

// ═══════════ Three-tier disclosure helpers ═══════════

/**
 * Load metadata about a file (first 10 lines + size).
 * Use when you want to KNOW a file exists without the full body.
 */
export async function loadFileMetadata(
  cache: ContextCache,
  path: string,
  fetchFn: (p: string) => Promise<string>,
): Promise<{ path: string; size: number; preview: string }> {
  return cache.load(`meta:${path}`, async () => {
    const full = await fetchFn(path);
    const preview = full.split("\n").slice(0, 10).join("\n");
    return { path, size: full.length, preview };
  }, "metadata");
}

/**
 * Load a compressed summary of a file (structure + key names).
 */
export async function loadFileSummary(
  cache: ContextCache,
  path: string,
  fetchFn: (p: string) => Promise<string>,
): Promise<{ path: string; size: number; summary: string }> {
  return cache.load(`summary:${path}`, async () => {
    const full = await fetchFn(path);
    const summary = summarizeFileContent(full);
    return { path, size: full.length, summary };
  }, "summary");
}

/**
 * Load the full content of a file.
 */
export async function loadFileFull(
  cache: ContextCache,
  path: string,
  fetchFn: (p: string) => Promise<string>,
): Promise<string> {
  return cache.load(`full:${path}`, () => fetchFn(path), "full");
}

/**
 * Summarize file content: extract imports, top-level declarations, comments.
 * Language-agnostic — uses line patterns.
 */
export function summarizeFileContent(content: string): string {
  const lines = content.split("\n");
  const totalLines = lines.length;

  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // JS/TS/Python imports
    if (/^(import|from|require\()/.test(trimmed)) {
      if (imports.length < 10) imports.push(trimmed.slice(0, 100));
    }
    // Top-level function
    const fnMatch = trimmed.match(/^(export\s+)?(async\s+)?(function|def|fn|func)\s+(\w+)/);
    if (fnMatch) {
      if (functions.length < 20) functions.push(fnMatch[4]);
    }
    // Class
    const clsMatch = trimmed.match(/^(export\s+)?(class|struct|interface|type)\s+(\w+)/);
    if (clsMatch) {
      if (classes.length < 20) classes.push(`${clsMatch[2]} ${clsMatch[3]}`);
    }
    // Top-level exports
    if (/^export\s+(const|let|var|default)/.test(trimmed)) {
      if (exports.length < 10) exports.push(trimmed.slice(0, 80));
    }
  }

  const parts: string[] = [`(${totalLines} lines)`];
  if (imports.length) parts.push(`Imports: ${imports.join("; ")}`);
  if (classes.length) parts.push(`Types/Classes: ${classes.join(", ")}`);
  if (functions.length) parts.push(`Functions: ${functions.join(", ")}`);
  if (exports.length) parts.push(`Exports: ${exports.join("; ")}`);
  return parts.join("\n");
}
