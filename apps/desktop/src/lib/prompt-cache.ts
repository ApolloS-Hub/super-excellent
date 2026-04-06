/**
 * Prompt Cache — LRU 缓存减少重复 API 调用
 *
 * - 最多 50 条，TTL 5 分钟
 * - key = hash(systemPrompt + recentMessages)
 * - 缓存非流式工具调用轮的 API 响应
 * - Anthropic ephemeral cache_control 注入
 */

const MAX_ENTRIES = 50;
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  accessedAt: number;
}

class LRUCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.map.delete(key);
      return null;
    }

    // LRU: 删除再插入，移到末尾
    this.map.delete(key);
    entry.accessedAt = Date.now();
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    if (this.map.size >= this.maxSize) {
      // 淘汰最老的（Map 迭代器第一个）
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }

    this.map.set(key, {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
    });
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** 清理过期条目 */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.map) {
      if (now - entry.createdAt > this.ttlMs) {
        this.map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

// 全局缓存实例
const promptCache = new LRUCache<unknown>(MAX_ENTRIES, TTL_MS);

/**
 * 简单字符串哈希（FNV-1a 变体）
 * 不需要加密安全，只需要快速且分布均匀
 */
function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 生成缓存 key
 * 取 systemPrompt + 最近 N 条消息的内容哈希
 */
export function buildCacheKey(
  systemPrompt: string,
  messages: Array<{ role: string; content: string | null }>,
  recentCount = 6,
): string {
  const recent = messages.slice(-recentCount);
  const raw = systemPrompt + "|" + recent.map(m => `${m.role}:${m.content ?? ""}`).join("|");
  return hashString(raw);
}

export function getCached<T>(key: string): T | null {
  return promptCache.get(key) as T | null;
}

export function setCache<T>(key: string, value: T): void {
  promptCache.set(key, value);
}

export function clearPromptCache(): void {
  promptCache.clear();
}

export function getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: promptCache.size, maxSize: MAX_ENTRIES, ttlMs: TTL_MS };
}

export function pruneExpired(): number {
  return promptCache.prune();
}

/**
 * Anthropic ephemeral cache_control 注入
 * 对 system prompt 和历史消息的前几条添加 cache_control: ephemeral
 * 让 Anthropic 服务端缓存这些不变的上下文
 */
export interface AnthropicCacheBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export function buildAnthropicSystemWithCache(
  systemPrompt: string,
): AnthropicCacheBlock[] {
  return [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];
}

export function injectAnthropicMessageCache(
  messages: Array<{ role: string; content: string | AnthropicCacheBlock[] }>,
): Array<{ role: string; content: string | AnthropicCacheBlock[] }> {
  if (messages.length === 0) return messages;

  return messages.map((msg, idx) => {
    // 只对前 4 条消息注入 cache_control（这些最不可能变化）
    if (idx >= 4 || typeof msg.content !== "string") return msg;

    return {
      ...msg,
      content: [
        {
          type: "text" as const,
          text: msg.content,
          cache_control: { type: "ephemeral" as const },
        },
      ],
    };
  });
}
