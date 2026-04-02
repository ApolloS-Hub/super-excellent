/**
 * Short-term memory — in-session context management
 * 
 * Keeps recent conversation context. When it exceeds the threshold,
 * auto-compacts older messages into summaries (like open-agent-sdk's auto-compact).
 */
import type { MemoryLayer, MemoryEntry } from "./types.js";

export class ShortTermMemory implements MemoryLayer {
  id = "short" as const;
  private entries: MemoryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  async store(key: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    this.entries.push({
      key,
      content,
      timestamp: Date.now(),
      metadata,
    });

    // Auto-compact if over threshold
    if (this.entries.length > this.maxEntries) {
      await this.compact();
    }
  }

  async retrieve(query: string, limit = 10): Promise<MemoryEntry[]> {
    // Simple keyword matching for short-term (no vector needed)
    const queryWords = query.toLowerCase().split(/\s+/);
    
    return this.entries
      .map(entry => ({
        ...entry,
        relevance: this.calculateRelevance(entry.content, queryWords),
      }))
      .filter(e => e.relevance > 0)
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  /** Get all entries (for context injection) */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Get recent N entries */
  getRecent(n: number): MemoryEntry[] {
    return this.entries.slice(-n);
  }

  private async compact(): Promise<void> {
    if (this.entries.length <= 10) return;

    // Keep last 10 entries, compress the rest into a summary
    const toCompress = this.entries.slice(0, -10);
    const kept = this.entries.slice(-10);

    const summary = toCompress
      .map(e => e.content.slice(0, 100))
      .join(" | ");

    this.entries = [
      {
        key: "compact-summary",
        content: `[Summary of ${toCompress.length} earlier entries]: ${summary}`,
        timestamp: Date.now(),
        metadata: { compacted: true, originalCount: toCompress.length },
      },
      ...kept,
    ];
  }

  private calculateRelevance(content: string, queryWords: string[]): number {
    const lower = content.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (lower.includes(word)) score += 1;
    }
    return score / queryWords.length;
  }
}
