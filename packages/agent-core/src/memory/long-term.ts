/**
 * Long-term memory — local vector search over conversation history.
 *
 * This stays offline/local-first by using a deterministic hashed embedding
 * instead of any remote embedding API. It is not LLM-grade semantics, but it is
 * materially better than raw keyword overlap because it mixes:
 * - normalized word tokens
 * - lightweight synonym expansion
 * - CJK/Latin character n-grams
 * - cosine similarity over dense vectors
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { MemoryLayer, MemoryEntry } from "./types.js";

const VECTOR_DIMENSIONS = 192;
const MAX_KEYWORDS = 64;
const MAX_CONTENT_LENGTH = 2000;
const MIN_RELEVANCE = 0.18;

const CANONICAL_SYNONYMS: Record<string, string[]> = {
  typescript: ["ts", "typed", "javascript", "typedjs", "statictyping"],
  javascript: ["js", "ecmascript", "frontend"],
  python: ["py", "scripting", "automation"],
  bug: ["issue", "defect", "problem", "error"],
  fix: ["repair", "resolve", "patch", "solution"],
  deploy: ["release", "ship", "publish", "上线", "发布"],
  auth: ["authentication", "login", "signin", "permission"],
  memory: ["recall", "context", "history"],
  vector: ["embedding", "semantic", "similarity"],
  test: ["testing", "spec", "assertion", "qa"],
  客服: ["支持", "工单", "helpdesk", "support"],
  风控: ["风险", "fraud", "compliance", "anomaly"],
  运营: ["增长", "留存", "渠道", "marketing"],
};

const SYNONYM_TO_CANONICAL = buildSynonymMap(CANONICAL_SYNONYMS);

interface StoredEntry {
  key: string;
  content: string;
  timestamp: number;
  keywords: string[];
  vector: number[];
  metadata?: Record<string, unknown>;
}

interface RankedEntry {
  entry: StoredEntry;
  relevance: number;
  index: number;
}

export class LongTermMemory implements MemoryLayer {
  id = "long" as const;
  private storageDir: string;
  private entries: StoredEntry[] = [];
  private loaded = false;
  private maxEntries: number;

  constructor(storageDir: string, maxEntries = 1000) {
    this.storageDir = storageDir;
    this.maxEntries = maxEntries;
  }

  async store(key: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.loadIfNeeded();

    const trimmed = content.slice(0, MAX_CONTENT_LENGTH);
    const keywords = extractKeywords(trimmed);
    const vector = embedText(trimmed, keywords);

    const entry: StoredEntry = {
      key,
      content: trimmed,
      timestamp: Date.now(),
      keywords,
      vector,
      metadata,
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    await this.persist();
  }

  async retrieve(query: string, limit = 5): Promise<MemoryEntry[]> {
    await this.loadIfNeeded();

    const queryKeywords = extractKeywords(query);
    const queryVector = embedText(query, queryKeywords);

    return this.entries
      .map((entry, index) => ({
        entry,
        relevance: cosineSimilarity(queryVector, entry.vector),
        index,
      }))
      .filter((item) => item.relevance >= MIN_RELEVANCE)
      .sort(compareRankedEntries)
      .slice(0, limit)
      .map(({ entry, relevance }) => ({
        key: entry.key,
        content: entry.content,
        timestamp: entry.timestamp,
        metadata: entry.metadata,
        relevance,
      }));
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  async storeConversation(summary: string, sessionId: string): Promise<void> {
    await this.store(`session-${sessionId}`, summary, { type: "conversation", sessionId });
  }

  async searchConversations(query: string, limit = 3): Promise<MemoryEntry[]> {
    const results = await this.retrieve(query, limit * 2);
    return results
      .filter((e) => e.metadata?.type === "conversation")
      .slice(0, limit);
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    try {
      const filePath = join(this.storageDir, "long-term.json");
      const data = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(data) as StoredEntry[];
      this.entries = parsed.map((entry) => normalizeStoredEntry(entry));
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(this.storageDir, { recursive: true });
      const filePath = join(this.storageDir, "long-term.json");
      await writeFile(filePath, JSON.stringify(this.entries, null, 2), "utf-8");
    } catch {
      // Silently fail to preserve browser/runtime resilience.
    }
  }
}

function normalizeStoredEntry(entry: StoredEntry): StoredEntry {
  const content = entry.content.slice(0, MAX_CONTENT_LENGTH);
  const keywords = Array.isArray(entry.keywords) && entry.keywords.length > 0
    ? entry.keywords.slice(0, MAX_KEYWORDS)
    : extractKeywords(content);
  const vector = Array.isArray(entry.vector) && entry.vector.length === VECTOR_DIMENSIONS
    ? normalizeVector(entry.vector)
    : embedText(content, keywords);

  return {
    key: entry.key,
    content,
    timestamp: entry.timestamp,
    keywords,
    vector,
    metadata: entry.metadata,
  };
}

function compareRankedEntries(a: RankedEntry, b: RankedEntry): number {
  if (b.relevance !== a.relevance) return b.relevance - a.relevance;
  if (b.entry.timestamp !== a.entry.timestamp) return b.entry.timestamp - a.entry.timestamp;
  return a.index - b.index;
}

function embedText(text: string, providedKeywords?: string[]): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  const normalized = normalizeText(text);
  const keywords = providedKeywords ?? extractKeywords(text);
  const grams = extractCharacterNgrams(normalized);

  for (const token of keywords) {
    addWeightedFeature(vector, `kw:${token}`, 3);
    for (const alias of expandToken(token)) {
      addWeightedFeature(vector, `alias:${alias}`, 2);
    }
  }

  for (const gram of grams) {
    addWeightedFeature(vector, `ng:${gram}`, 1);
  }

  return normalizeVector(vector);
}

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  const words = normalized
    .split(/\s+/)
    .map((word) => canonicalizeToken(word))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

  const unique = new Set<string>();
  for (const word of words) {
    unique.add(word);
    for (const alias of expandToken(word)) {
      if (!STOP_WORDS.has(alias)) unique.add(alias);
    }
    if (unique.size >= MAX_KEYWORDS) break;
  }

  return [...unique].slice(0, MAX_KEYWORDS);
}

function extractCharacterNgrams(text: string): string[] {
  const compact = text.replace(/\s+/g, "");
  const grams: string[] = [];

  for (let i = 0; i < compact.length; i++) {
    const char = compact[i];
    if (!char) continue;
    grams.push(char);
    if (i + 1 < compact.length) grams.push(compact.slice(i, i + 2));
    if (i + 2 < compact.length) grams.push(compact.slice(i, i + 3));
    if (grams.length >= MAX_KEYWORDS * 4) break;
  }

  return grams;
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

function canonicalizeToken(token: string): string {
  return SYNONYM_TO_CANONICAL.get(token) ?? token;
}

function expandToken(token: string): string[] {
  const canonical = canonicalizeToken(token);
  return CANONICAL_SYNONYMS[canonical] ?? [];
}

function addWeightedFeature(vector: number[], feature: string, weight: number): void {
  const seed = hashFeature(feature);
  const index = Math.abs(seed) % VECTOR_DIMENSIONS;
  const sign = seed % 2 === 0 ? 1 : -1;
  vector[index] += sign * weight;

  const secondaryIndex = Math.abs(seed * 31) % VECTOR_DIMENSIONS;
  vector[secondaryIndex] += sign * weight * 0.5;
}

function normalizeVector(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (!magnitude) return vector.map(() => 0);
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
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

function hashFeature(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function buildSynonymMap(source: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(source)) {
    map.set(canonical, canonical);
    for (const alias of aliases) {
      map.set(alias, canonical);
    }
  }
  return map;
}

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
