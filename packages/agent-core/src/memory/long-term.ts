/**
 * Long-term memory — semantic search over conversation history
 * 
 * Uses a simple local embedding approach for MVP.
 * Future: integrate with vector DB (Qdrant/ChromaDB) or embedding APIs.
 * 
 * For now: TF-IDF-like keyword matching stored in JSON files.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { MemoryLayer, MemoryEntry } from "./types.js";

interface StoredEntry {
  key: string;
  content: string;
  timestamp: number;
  keywords: string[];
  metadata?: Record<string, unknown>;
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

    const entry: StoredEntry = {
      key,
      content: content.slice(0, 2000), // Cap stored content
      timestamp: Date.now(),
      keywords: this.extractKeywords(content),
      metadata,
    };

    this.entries.push(entry);

    // Trim to max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    await this.persist();
  }

  async retrieve(query: string, limit = 5): Promise<MemoryEntry[]> {
    await this.loadIfNeeded();

    const queryKeywords = this.extractKeywords(query);

    return this.entries
      .map(entry => ({
        key: entry.key,
        content: entry.content,
        timestamp: entry.timestamp,
        metadata: entry.metadata,
        relevance: this.calculateSimilarity(queryKeywords, entry.keywords),
      }))
      .filter(e => e.relevance > 0.1)
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  /** Store a conversation summary for later retrieval */
  async storeConversation(summary: string, sessionId: string): Promise<void> {
    await this.store(`session-${sessionId}`, summary, { type: "conversation", sessionId });
  }

  /** Search past conversations */
  async searchConversations(query: string, limit = 3): Promise<MemoryEntry[]> {
    const results = await this.retrieve(query, limit * 2);
    return results
      .filter(e => e.metadata?.type === "conversation")
      .slice(0, limit);
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "about", "like",
      "through", "after", "over", "between", "out", "against", "during",
      "without", "before", "under", "around", "among", "and", "but", "or",
      "not", "no", "if", "then", "else", "when", "up", "so", "than",
      "too", "very", "just", "that", "this", "it", "its", "my", "your",
      "我", "你", "他", "她", "它", "的", "了", "在", "是", "有", "和",
      "与", "也", "都", "而", "及", "或", "但", "不", "这", "那", "就",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w))
      .slice(0, 50);
  }

  private calculateSimilarity(queryKw: string[], entryKw: string[]): number {
    if (queryKw.length === 0 || entryKw.length === 0) return 0;
    const entrySet = new Set(entryKw);
    let overlap = 0;
    for (const kw of queryKw) {
      if (entrySet.has(kw)) overlap++;
    }
    return overlap / Math.max(queryKw.length, 1);
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    try {
      const filePath = join(this.storageDir, "long-term.json");
      const data = await readFile(filePath, "utf-8");
      this.entries = JSON.parse(data);
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
      // Silently fail
    }
  }
}
