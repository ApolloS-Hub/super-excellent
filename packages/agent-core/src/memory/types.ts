/**
 * Three-layer memory architecture
 * 
 * Inspired by:
 * - Claudebot-vibe's 4-layer memory (soul/projects/tasks/notes + vector + summaries)
 * - open-agent-sdk's auto-compact/micro-compact
 * - Shannon's Qdrant vector memory
 * 
 * Layer 1 — Short-term (in-session): auto-compact when context fills up
 * Layer 2 — Mid-term (session-level): persisted files (tasks, notes, project context)
 * Layer 3 — Long-term (cross-session): vector semantic search over history
 */

export interface MemoryLayer {
  /** Layer identifier */
  id: "short" | "mid" | "long";
  /** Store a memory entry */
  store(key: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  /** Retrieve memory by key or query */
  retrieve(query: string, limit?: number): Promise<MemoryEntry[]>;
  /** Clear all entries */
  clear(): Promise<void>;
}

export interface MemoryEntry {
  key: string;
  content: string;
  timestamp: number;
  relevance?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryConfig {
  /** Directory for persistent storage */
  storageDir: string;
  /** Max entries for short-term before compaction */
  shortTermMaxEntries: number;
  /** Max entries for mid-term */
  midTermMaxEntries: number;
}

export interface MemorySnapshot {
  /** Relevant context to inject into system prompt */
  context: string;
  /** Number of entries used */
  entriesUsed: number;
}
