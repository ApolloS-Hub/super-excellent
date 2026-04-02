/**
 * Mid-term memory — session-level persistent files
 * 
 * Inspired by Claudebot-vibe's soul/projects/tasks/notes system.
 * Persists structured knowledge to local files that survive restarts.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { MemoryLayer, MemoryEntry } from "./types.js";

export interface MidTermSlot {
  key: string;
  label: string;
  description: string;
}

/** Pre-defined memory slots */
export const MEMORY_SLOTS: MidTermSlot[] = [
  { key: "soul", label: "Identity", description: "Who the user is, preferences, communication style" },
  { key: "projects", label: "Projects", description: "Active projects, goals, tech stack" },
  { key: "tasks", label: "Tasks", description: "Current tasks, priorities, deadlines" },
  { key: "notes", label: "Notes", description: "Important notes, decisions, learnings" },
  { key: "context", label: "Context", description: "Working directory, recent files, session context" },
];

export class MidTermMemory implements MemoryLayer {
  id = "mid" as const;
  private storageDir: string;
  private cache: Map<string, MemoryEntry> = new Map();

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  async store(key: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: MemoryEntry = {
      key,
      content,
      timestamp: Date.now(),
      metadata,
    };

    this.cache.set(key, entry);

    // Persist to file
    try {
      await mkdir(this.storageDir, { recursive: true });
      const filePath = join(this.storageDir, `${key}.md`);
      await writeFile(filePath, content, "utf-8");
    } catch {
      // Silently fail if write fails (e.g., in browser context)
    }
  }

  async retrieve(query: string, limit = 5): Promise<MemoryEntry[]> {
    // Load all slots from cache or disk
    await this.loadAll();

    const queryWords = query.toLowerCase().split(/\s+/);
    
    return [...this.cache.values()]
      .map(entry => ({
        ...entry,
        relevance: this.calculateRelevance(entry.content, queryWords),
      }))
      .filter(e => e.relevance > 0)
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  /** Get a specific memory slot */
  async getSlot(key: string): Promise<string | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!.content;
    }

    try {
      const filePath = join(this.storageDir, `${key}.md`);
      const content = await readFile(filePath, "utf-8");
      this.cache.set(key, { key, content, timestamp: Date.now() });
      return content;
    } catch {
      return null;
    }
  }

  /** Update a specific slot */
  async updateSlot(key: string, content: string): Promise<void> {
    await this.store(key, content);
  }

  /** Get all memory as context string */
  async getContextString(): Promise<string> {
    await this.loadAll();
    
    const parts: string[] = [];
    for (const slot of MEMORY_SLOTS) {
      const entry = this.cache.get(slot.key);
      if (entry?.content) {
        parts.push(`## ${slot.label}\n${entry.content}`);
      }
    }

    return parts.length ? parts.join("\n\n") : "";
  }

  private async loadAll(): Promise<void> {
    for (const slot of MEMORY_SLOTS) {
      if (!this.cache.has(slot.key)) {
        try {
          const filePath = join(this.storageDir, `${slot.key}.md`);
          const content = await readFile(filePath, "utf-8");
          this.cache.set(slot.key, { key: slot.key, content, timestamp: Date.now() });
        } catch {
          // Slot doesn't exist yet
        }
      }
    }
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
