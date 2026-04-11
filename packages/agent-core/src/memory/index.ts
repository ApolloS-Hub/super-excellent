/**
 * Memory Manager — coordinates all three memory layers
 */
import { ShortTermMemory } from "./short-term.js";
import { MidTermMemory } from "./mid-term.js";
import { LongTermMemory } from "./long-term.js";
import type { MemoryConfig, MemorySnapshot } from "./types.js";

export class MemoryManager {
  readonly shortTerm: ShortTermMemory;
  readonly midTerm: MidTermMemory;
  readonly longTerm: LongTermMemory;

  constructor(config: Partial<MemoryConfig> = {}) {
    const storageDir = config.storageDir ?? ".super-excellent/memory";
    this.shortTerm = new ShortTermMemory(config.shortTermMaxEntries ?? 50);
    this.midTerm = new MidTermMemory(storageDir);
    this.longTerm = new LongTermMemory(storageDir, config.midTermMaxEntries ?? 1000);
  }

  /**
   * Get a memory snapshot for system prompt injection.
   * Gathers relevant context from all layers based on the current query.
   */
  async getSnapshot(query: string): Promise<MemorySnapshot> {
    const parts: string[] = [];
    let entriesUsed = 0;

    // Mid-term: always inject persistent context
    const midContext = await this.midTerm.getContextString();
    if (midContext) {
      parts.push("# Memory\n" + midContext);
      entriesUsed += 5;
    }

    // Long-term: search for relevant past conversations
    const longResults = await this.longTerm.retrieve(query, 3);
    if (longResults.length > 0) {
      const longContext = longResults
        .map(r => `- ${r.content.slice(0, 300)}`)
        .join("\n");
      parts.push("# Relevant History\n" + longContext);
      entriesUsed += longResults.length;
    }

    // Short-term: recent context (handled by conversation history, not injected separately)

    return {
      context: parts.join("\n\n"),
      entriesUsed,
    };
  }

  /**
   * After a conversation turn, extract and store important information
   */
  async processConversationTurn(userMessage: string, assistantResponse: string): Promise<void> {
    // Short-term: store the exchange
    await this.shortTerm.store(`turn-${Date.now()}`, `User: ${userMessage}\nAssistant: ${assistantResponse.slice(0, 500)}`);

    // Long-term: store for future retrieval
    await this.longTerm.store(
      `conv-${Date.now()}`,
      `Q: ${userMessage}\nA: ${assistantResponse.slice(0, 500)}`,
      { type: "conversation" },
    );
  }

  /**
   * Update a mid-term memory slot
   */
  async updateProfile(slot: string, content: string): Promise<void> {
    await this.midTerm.updateSlot(slot, content);
  }

  async clear(): Promise<void> {
    await this.shortTerm.clear();
    await this.midTerm.clear();
    // Long-term is intentionally NOT cleared (persistent knowledge)
  }
}

export { ShortTermMemory } from "./short-term.js";
export { MidTermMemory, MEMORY_SLOTS } from "./mid-term.js";
export { LongTermMemory } from "./long-term.js";
export type { MemoryConfig, MemorySnapshot, MemoryEntry, MemoryLayer } from "./types.js";
export * from "./learnings.js";
export type { Learning, LearningStore } from "./learnings.js";
export { createEmbeddingProvider, LocalEmbeddings, cosineSimilarity } from "./embeddings.js";
export type { EmbeddingProvider } from "./embeddings.js";
