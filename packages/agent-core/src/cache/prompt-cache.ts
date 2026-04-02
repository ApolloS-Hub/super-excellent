/**
 * Prompt Cache Manager — Maximizes cache hit rates
 * 
 * Strategies from claude-code-haha + open-agent-sdk:
 * 1. System prompt caching (Anthropic's cache_control: ephemeral)
 * 2. Conversation compaction (auto-compact when context fills)
 * 3. Micro-compact (truncate oversized tool results)
 * 4. Token budget control
 * 5. Stable system prompt ordering for cache hits
 */

export interface CacheConfig {
  /** Max context window tokens (estimate) */
  maxContextTokens: number;
  /** Compact when usage exceeds this % of context */
  compactThresholdPercent: number;
  /** Max tokens for a single tool result */
  maxToolResultTokens: number;
  /** Enable Anthropic prompt caching */
  enablePromptCaching: boolean;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxContextTokens: 200000, // Claude Sonnet default
  compactThresholdPercent: 80,
  maxToolResultTokens: 10000,
  enablePromptCaching: true,
};

export class PromptCacheManager {
  private config: CacheConfig;
  private tokenEstimate = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Estimate tokens for a string (rough: 1 token ≈ 4 chars for English, 2 chars for CJK)
   */
  estimateTokens(text: string): number {
    const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    const otherCount = text.length - cjkCount;
    return Math.ceil(cjkCount / 1.5 + otherCount / 4);
  }

  /**
   * Check if we should compact the conversation
   */
  shouldCompact(currentTokens: number): boolean {
    const threshold = this.config.maxContextTokens * (this.config.compactThresholdPercent / 100);
    return currentTokens > threshold;
  }

  /**
   * Micro-compact: truncate a tool result if too long
   */
  microCompact(toolResult: string): string {
    const tokens = this.estimateTokens(toolResult);
    if (tokens <= this.config.maxToolResultTokens) {
      return toolResult;
    }

    // Truncate with indicator
    const maxChars = this.config.maxToolResultTokens * 3; // rough char estimate
    return toolResult.slice(0, maxChars) + "\n... [truncated, " + tokens + " tokens total]";
  }

  /**
   * Build a cache-optimized system prompt.
   * Key insight: keep the static parts at the beginning (cacheable),
   * dynamic parts at the end.
   */
  buildSystemPrompt(parts: {
    base: string;          // Static base prompt (highly cacheable)
    tools?: string;        // Tool descriptions (semi-static, cacheable)
    memory?: string;       // Memory context (changes per session)
    sessionContext?: string; // Current session info (changes frequently)
  }): string {
    const sections: string[] = [];

    // Static parts first (maximizes cache hits)
    sections.push(parts.base);

    if (parts.tools) {
      sections.push("\n---\n# Available Tools\n" + parts.tools);
    }

    // Dynamic parts at the end (only these change between requests)
    if (parts.memory) {
      sections.push("\n---\n# Memory Context\n" + parts.memory);
    }

    if (parts.sessionContext) {
      sections.push("\n---\n# Session\n" + parts.sessionContext);
    }

    return sections.join("\n");
  }

  /**
   * Get current token budget remaining
   */
  getRemainingBudget(currentTokens: number): number {
    return Math.max(0, this.config.maxContextTokens - currentTokens);
  }

  /**
   * Get cache stats
   */
  getStats(): { maxTokens: number; compactThreshold: number; cachingEnabled: boolean } {
    return {
      maxTokens: this.config.maxContextTokens,
      compactThreshold: Math.floor(this.config.maxContextTokens * this.config.compactThresholdPercent / 100),
      cachingEnabled: this.config.enablePromptCaching,
    };
  }
}
