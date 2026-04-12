/**
 * Memory Bridge — connects agent-core's three-layer memory system to the desktop app
 *
 * Adapts agent-core's file-based MemoryManager for the browser environment:
 *   Short-term  → in-memory ring buffer (same as agent-core)
 *   Mid-term    → localStorage-backed persistent slots (replaces fs)
 *   Long-term   → IndexedDB with vector-like keyword search (replaces fs JSON)
 *
 * Re-uses the desktop's existing memory infrastructure (memory.ts, memory-store.ts)
 * while exposing the same conceptual API as agent-core's MemoryManager.
 */

import {
  pushShortTerm,
  clearShortTerm,
  saveMidTerm,
  queryMidTerm,
  buildMidTermSummary,
  clearMidTerm,
  searchMemory,
  appendMemory,
  loadMemory,
  autoLearn,
} from "./memory";
import { memoryStore } from "./memory-store";
import i18n from "../i18n";
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ────────────────────────── Types ──────────────────────────

export interface MemoryBridgeStats {
  shortTerm: number;
  midTerm: number;
  longTerm: number;
}

export interface MemoryBridgeConfig {
  /** Max short-term entries before compaction */
  shortTermCap?: number;
  /** Max long-term entries stored in IndexedDB */
  longTermCap?: number;
  /** Whether to run autoLearn on each conversation turn */
  enableAutoLearn?: boolean;
}

// ────────────────────────── Constants ──────────────────────────

const DEFAULT_SHORT_TERM_CAP = 50;
const DEFAULT_LONG_TERM_CAP = 1000;

const LONG_TERM_IDB_NAME = "super-excellent-longterm";
const LONG_TERM_IDB_VERSION = 1;
const LONG_TERM_IDB_STORE = "entries";

const VECTOR_DIMENSIONS = 128;
const MAX_KEYWORDS = 48;
const MIN_RELEVANCE = 0.15;

// ────────────────────────── Long-term IndexedDB helpers ──────────────────────────

interface LongTermStoredEntry {
  key: string;
  content: string;
  timestamp: number;
  keywords: string[];
  vector: number[];
  metadata?: Record<string, unknown>;
}

function openLongTermDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(LONG_TERM_IDB_NAME, LONG_TERM_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LONG_TERM_IDB_STORE)) {
        const store = db.createObjectStore(LONG_TERM_IDB_STORE, { keyPath: "key" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function longTermTx(
  mode: IDBTransactionMode,
): Promise<{ store: IDBObjectStore; done: Promise<void> }> {
  return openLongTermDB().then((db) => {
    const tx = db.transaction(LONG_TERM_IDB_STORE, mode);
    const store = tx.objectStore(LONG_TERM_IDB_STORE);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    return { store, done };
  });
}

// ────────────────────────── Lightweight vector helpers ──────────────────────────
// Mirrors agent-core's LongTermMemory hashing/embedding approach but
// streamlined for browser use.

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "like",
  "through", "after", "over", "between", "out", "against", "during",
  "without", "before", "under", "around", "among", "and", "but", "or",
  "not", "no", "if", "then", "else", "when", "up", "so", "than",
  "too", "very", "just", "that", "this", "it", "its", "my", "your",
  "our", "their", "we", "they", "he", "she", "them", "you", "me",
  "我", "你", "他", "她", "它", "的", "了", "在", "是", "有", "和",
  "与", "也", "都", "而", "及", "或", "但", "不", "这", "那", "就",
]);

const SYNONYM_MAP: Record<string, string[]> = {
  typescript: ["ts", "javascript"],
  javascript: ["js", "ecmascript"],
  python: ["py"],
  bug: ["issue", "defect", "error", "problem"],
  fix: ["repair", "resolve", "patch"],
  deploy: ["release", "ship", "publish"],
  auth: ["authentication", "login", "signin"],
  memory: ["recall", "context", "history"],
  test: ["testing", "spec", "qa"],
};

function hashFeature(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^\w\u4e00-\u9fff\s-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  const words = normalized
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const unique = new Set<string>();
  for (const word of words) {
    unique.add(word);
    const aliases = SYNONYM_MAP[word];
    if (aliases) {
      for (const alias of aliases) unique.add(alias);
    }
    if (unique.size >= MAX_KEYWORDS) break;
  }
  return [...unique].slice(0, MAX_KEYWORDS);
}

function embedText(text: string, keywords?: string[]): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  const kws = keywords ?? extractKeywords(text);

  for (const token of kws) {
    const seed = hashFeature(`kw:${token}`);
    const idx = Math.abs(seed) % VECTOR_DIMENSIONS;
    const sign = seed % 2 === 0 ? 1 : -1;
    vector[idx] += sign * 3;

    const idx2 = Math.abs(seed * 31) % VECTOR_DIMENSIONS;
    vector[idx2] += sign * 1.5;
  }

  // Character n-grams for broader coverage
  const compact = normalizeText(text).replace(/\s+/g, "");
  for (let i = 0; i < Math.min(compact.length, 120); i++) {
    if (i + 2 < compact.length) {
      const gram = compact.slice(i, i + 3);
      const seed = hashFeature(`ng:${gram}`);
      const idx = Math.abs(seed) % VECTOR_DIMENSIONS;
      vector[idx] += seed % 2 === 0 ? 1 : -1;
    }
  }

  // Normalize
  let sumSq = 0;
  for (const v of vector) sumSq += v * v;
  const mag = Math.sqrt(sumSq);
  if (mag === 0) return vector;
  return vector.map((v) => v / mag);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < size; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / Math.sqrt(magA * magB);
}

// ────────────────────────── MemoryBridge Class ──────────────────────────

/**
 * Singleton bridge connecting agent-core's three-layer memory architecture
 * to the desktop app's browser-based storage.
 */
class MemoryBridge {
  private initialized = false;
  private config: Required<MemoryBridgeConfig>;

  // Short-term: in-memory compactable buffer mirroring agent-core's ShortTermMemory
  private shortTermEntries: Array<{ key: string; content: string; timestamp: number }> = [];

  // Long-term: cached count (actual data lives in IndexedDB)
  private longTermCount = 0;

  constructor(config: MemoryBridgeConfig = {}) {
    this.config = {
      shortTermCap: config.shortTermCap ?? DEFAULT_SHORT_TERM_CAP,
      longTermCap: config.longTermCap ?? DEFAULT_LONG_TERM_CAP,
      enableAutoLearn: config.enableAutoLearn ?? true,
    };
  }

  // ═══════════ Initialization ═══════════

  /**
   * Initialize the memory bridge. Safe to call multiple times.
   * Hydrates long-term count from IndexedDB and prunes stale mid-term entries.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Hydrate long-term entry count
      this.longTermCount = await this.countLongTermEntries();
    } catch {
      this.longTermCount = 0;
    }

    this.initialized = true;
  }

  // ═══════════ Context Retrieval ═══════════

  /**
   * Build a memory context string suitable for system prompt injection.
   * Mirrors agent-core's MemoryManager.getSnapshot() but pulls from
   * browser-compatible storage.
   */
  async getMemoryContext(query: string): Promise<string> {
    await this.ensureInitialized();

    const parts: string[] = [];

    // Layer 2 — Mid-term: user preferences and habits (always injected)
    const midTermContext = await this.buildMidTermContext();
    if (midTermContext) {
      parts.push("# Memory\n" + midTermContext);
    }

    // Layer 3 — Long-term: search relevant past conversations
    const longTermResults = await this.searchLongTerm(query, 3);
    if (longTermResults.length > 0) {
      const longContext = longTermResults
        .map((r) => `- ${r.content.slice(0, 300)}`)
        .join("\n");
      parts.push("# Relevant History\n" + longContext);
    }

    // Layer 1 — Short-term: recent session context
    const shortTermContext = this.buildShortTermContext();
    if (shortTermContext) {
      parts.push("# Current Session\n" + shortTermContext);
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  // ═══════════ Conversation Recording ═══════════

  /**
   * Record a conversation turn across all memory layers.
   * Mirrors agent-core's MemoryManager.processConversationTurn().
   */
  async recordConversation(userMsg: string, assistantMsg: string): Promise<void> {
    await this.ensureInitialized();

    const now = Date.now();
    const truncatedAssistant = assistantMsg.slice(0, 500);

    // Layer 1 — Short-term: store the exchange in memory
    this.addShortTermEntry(
      `turn-${now}`,
      `User: ${userMsg}\nAssistant: ${truncatedAssistant}`,
    );

    // Also push to the desktop's existing short-term buffer for compatibility
    pushShortTerm({
      content: `User: ${userMsg}`,
      timestamp: now,
      source: "user",
    });
    pushShortTerm({
      content: `Assistant: ${truncatedAssistant}`,
      timestamp: now,
      source: "auto",
    });

    // Layer 3 — Long-term: persist to IndexedDB for future retrieval
    await this.storeLongTerm(
      `conv-${now}`,
      `Q: ${userMsg}\nA: ${truncatedAssistant}`,
      { type: "conversation" },
    );

    // Auto-learn user patterns into mid-term (desktop's existing autoLearn)
    if (this.config.enableAutoLearn) {
      autoLearn(userMsg, assistantMsg);
    }
  }

  // ═══════════ User Preferences (Mid-term) ═══════════

  /**
   * Store a user preference in mid-term memory.
   * Maps to agent-core's MemoryManager.updateProfile().
   */
  async updateUserPreference(key: string, value: string): Promise<void> {
    await this.ensureInitialized();

    // Store in desktop's mid-term (IndexedDB via memory.ts)
    await saveMidTerm({ category: "preference", content: `${key}: ${value}` });

    // Also persist to the memory-store for structured access
    await memoryStore.save({
      key: `pref:${key}`,
      content: value,
      category: "preference",
    });

    // And to localStorage long-term memory for backward compatibility
    appendMemory(`${t("memory.preferenceLabel")}: ${key} = ${value}`);
  }

  // ═══════════ Stats ═══════════

  /**
   * Get entry counts for each memory layer.
   * Useful for the monitor/debug page.
   */
  getMemoryStats(): MemoryBridgeStats {
    return {
      shortTerm: this.shortTermEntries.length,
      midTerm: this.getMidTermCountSync(),
      longTerm: this.longTermCount,
    };
  }

  /**
   * Async version that refreshes counts from storage before returning.
   */
  async getMemoryStatsAsync(): Promise<MemoryBridgeStats> {
    await this.ensureInitialized();

    const midTermRecords = await queryMidTerm();
    this.longTermCount = await this.countLongTermEntries();

    return {
      shortTerm: this.shortTermEntries.length,
      midTerm: midTermRecords.length,
      longTerm: this.longTermCount,
    };
  }

  // ═══════════ Session Management ═══════════

  /**
   * Clear short-term memory when starting a new session.
   * Preserves mid-term and long-term data.
   */
  async clearSessionMemory(): Promise<void> {
    this.shortTermEntries = [];
    clearShortTerm();
  }

  /**
   * Full reset — clears all layers. Use with caution.
   */
  async clearAll(): Promise<void> {
    this.shortTermEntries = [];
    clearShortTerm();
    await clearMidTerm();
    await this.clearLongTermStore();
    this.longTermCount = 0;
  }

  // ═══════════ Short-term Layer (in-memory) ═══════════

  private addShortTermEntry(key: string, content: string): void {
    this.shortTermEntries.push({ key, content, timestamp: Date.now() });

    // Auto-compact when over threshold (mirrors agent-core's ShortTermMemory.compact)
    if (this.shortTermEntries.length > this.config.shortTermCap) {
      this.compactShortTerm();
    }
  }

  private compactShortTerm(): void {
    if (this.shortTermEntries.length <= 10) return;

    const toCompress = this.shortTermEntries.slice(0, -10);
    const kept = this.shortTermEntries.slice(-10);

    const summary = toCompress
      .map((e) => e.content.slice(0, 100))
      .join(" | ");

    this.shortTermEntries = [
      {
        key: "compact-summary",
        content: `[Summary of ${toCompress.length} earlier entries]: ${summary}`,
        timestamp: Date.now(),
      },
      ...kept,
    ];
  }

  private buildShortTermContext(): string {
    if (this.shortTermEntries.length === 0) return "";

    const recent = this.shortTermEntries.slice(-10);
    return recent.map((e) => `- ${e.content.slice(0, 200)}`).join("\n");
  }

  // ═══════════ Mid-term Layer (localStorage + IndexedDB) ═══════════

  private async buildMidTermContext(): Promise<string> {
    // Combine the desktop's mid-term summary with memory-store entries
    const parts: string[] = [];

    const midSummary = await buildMidTermSummary();
    if (midSummary) {
      parts.push(midSummary);
    }

    const storeSection = await memoryStore.buildPromptSection(10);
    if (storeSection) {
      parts.push(storeSection);
    }

    return parts.join("\n\n");
  }

  private getMidTermCountSync(): number {
    // Best-effort sync count from localStorage
    const content = loadMemory();
    if (!content) return 0;
    return content.split("\n").filter((l) => l.trim().startsWith("-")).length;
  }

  // ═══════════ Long-term Layer (IndexedDB with vector search) ═══════════

  private async storeLongTerm(
    key: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const trimmed = content.slice(0, 2000);
      const keywords = extractKeywords(trimmed);
      const vector = embedText(trimmed, keywords);

      const entry: LongTermStoredEntry = {
        key,
        content: trimmed,
        timestamp: Date.now(),
        keywords,
        vector,
        metadata,
      };

      const { store, done } = await longTermTx("readwrite");
      store.put(entry);
      await done;

      this.longTermCount++;

      // Prune if over capacity
      if (this.longTermCount > this.config.longTermCap) {
        await this.pruneLongTerm();
      }
    } catch {
      // Silently fail — long-term storage is best-effort
    }
  }

  private async searchLongTerm(
    query: string,
    limit = 5,
  ): Promise<Array<{ content: string; relevance: number; timestamp: number }>> {
    try {
      const queryKeywords = extractKeywords(query);
      const queryVector = embedText(query, queryKeywords);

      const entries = await this.loadAllLongTerm();

      return entries
        .map((entry) => ({
          content: entry.content,
          timestamp: entry.timestamp,
          relevance: cosineSimilarity(queryVector, entry.vector),
        }))
        .filter((item) => item.relevance >= MIN_RELEVANCE)
        .sort((a, b) => {
          if (b.relevance !== a.relevance) return b.relevance - a.relevance;
          return b.timestamp - a.timestamp;
        })
        .slice(0, limit);
    } catch {
      // Fall back to desktop's simpler keyword search
      const results = searchMemory(query);
      return results.slice(0, limit).map((content) => ({
        content,
        relevance: 0.5,
        timestamp: Date.now(),
      }));
    }
  }

  private async loadAllLongTerm(): Promise<LongTermStoredEntry[]> {
    const { store, done } = await longTermTx("readonly");
    const results: LongTermStoredEntry[] = [];

    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        results.push(c.value as LongTermStoredEntry);
        c.continue();
      }
    };

    await done;
    return results;
  }

  private async countLongTermEntries(): Promise<number> {
    try {
      const { store, done } = await longTermTx("readonly");
      const countReq = store.count();
      let result = 0;
      countReq.onsuccess = () => { result = countReq.result; };
      await done;
      return result;
    } catch {
      return 0;
    }
  }

  private async pruneLongTerm(): Promise<void> {
    try {
      const entries = await this.loadAllLongTerm();
      if (entries.length <= this.config.longTermCap) return;

      // Sort by timestamp ascending (oldest first), remove excess
      const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = sorted.slice(0, entries.length - this.config.longTermCap);

      const { store, done } = await longTermTx("readwrite");
      for (const entry of toRemove) {
        store.delete(entry.key);
      }
      await done;

      this.longTermCount = this.config.longTermCap;
    } catch {
      // Best-effort pruning
    }
  }

  private async clearLongTermStore(): Promise<void> {
    try {
      const { store, done } = await longTermTx("readwrite");
      store.clear();
      await done;
    } catch {
      // Ignore
    }
  }

  // ═══════════ Internal ═══════════

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}

// ────────────────────────── Singleton & Exported API ──────────────────────────

/** Singleton MemoryBridge instance */
export const memoryBridge = new MemoryBridge();

/**
 * Initialize the memory bridge. Call once at app startup.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initMemoryBridge(config?: MemoryBridgeConfig): Promise<void> {
  if (config) {
    // Re-create with custom config if provided
    Object.assign(memoryBridge, new MemoryBridge(config));
  }
  await memoryBridge.init();
}

/**
 * Get memory context string for system prompt injection.
 * Gathers relevant context from all three layers based on the current query.
 */
export async function getMemoryContext(query: string): Promise<string> {
  return memoryBridge.getMemoryContext(query);
}

/**
 * Record a conversation turn across all memory layers.
 * Call after each assistant response.
 */
export async function recordConversation(
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  return memoryBridge.recordConversation(userMsg, assistantMsg);
}

/**
 * Store a user preference in mid-term memory.
 */
export async function updateUserPreference(
  key: string,
  value: string,
): Promise<void> {
  return memoryBridge.updateUserPreference(key, value);
}

/**
 * Get entry counts for each memory layer (sync, best-effort).
 * For accurate counts, use memoryBridge.getMemoryStatsAsync().
 */
export function getMemoryStats(): MemoryBridgeStats {
  return memoryBridge.getMemoryStats();
}

/**
 * Clear short-term memory for a new session.
 * Preserves mid-term preferences and long-term history.
 */
export async function clearSessionMemory(): Promise<void> {
  return memoryBridge.clearSessionMemory();
}
