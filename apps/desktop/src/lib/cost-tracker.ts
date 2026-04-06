/**
 * Cost Tracker — track token usage and estimated costs per conversation
 * Inspired by Claude Code's cost-tracker.ts
 */

export interface UsageRecord {
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ConversationUsage {
  conversationId: string;
  records: UsageRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

// Price per 1M tokens (input/output)
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3.5-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "moonshot-v1-8k": { input: 1, output: 2 },
  "moonshot-v1-32k": { input: 2, output: 4 },
};

function getPrice(model: string): { input: number; output: number } {
  const key = Object.keys(MODEL_PRICES).find(k => model.toLowerCase().includes(k.toLowerCase()));
  return key ? MODEL_PRICES[key] : { input: 1, output: 2 }; // default fallback
}

const DB_NAME = "super-excellent";
const STORE_NAME = "usage";

let dbReady: Promise<IDBDatabase> | null = null;

function openUsageDB(): Promise<IDBDatabase> {
  if (dbReady) return dbReady;
  dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("conversations")) {
        const cs = db.createObjectStore("conversations", { keyPath: "id" });
        cs.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const us = db.createObjectStore(STORE_NAME, { keyPath: "conversationId" });
        us.createIndex("totalCost", "totalCost", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbReady;
}

export function recordUsage(
  conversationId: string,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): UsageRecord | null {
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || inputTokens + outputTokens;
  const price = getPrice(model);
  const estimatedCost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

  const record: UsageRecord = {
    timestamp: Date.now(),
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
  };

  // Fire and forget: save to IndexedDB
  saveUsageRecord(conversationId, record).catch(console.error);
  return record;
}

async function saveUsageRecord(conversationId: string, record: UsageRecord): Promise<void> {
  try {
    const db = await openUsageDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const existing = await new Promise<ConversationUsage | undefined>((resolve) => {
      const req = store.get(conversationId);
      req.onsuccess = () => resolve(req.result as ConversationUsage | undefined);
      req.onerror = () => resolve(undefined);
    });

    const usage: ConversationUsage = existing || {
      conversationId,
      records: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
    };

    usage.records.push(record);
    usage.totalInputTokens += record.inputTokens;
    usage.totalOutputTokens += record.outputTokens;
    usage.totalCost += record.estimatedCost;

    store.put(usage);
  } catch { /* ignore in dev */ }
}

export async function getConversationUsage(conversationId: string): Promise<ConversationUsage | null> {
  try {
    const db = await openUsageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(conversationId);
      req.onsuccess = () => resolve(req.result as ConversationUsage | null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getTotalUsage(): Promise<{ totalCost: number; totalTokens: number }> {
  try {
    const db = await openUsageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const all = req.result as ConversationUsage[];
        const totalCost = all.reduce((s, u) => s + u.totalCost, 0);
        const totalTokens = all.reduce((s, u) => s + u.totalInputTokens + u.totalOutputTokens, 0);
        resolve({ totalCost, totalTokens });
      };
      req.onerror = () => resolve({ totalCost: 0, totalTokens: 0 });
    });
  } catch {
    return { totalCost: 0, totalTokens: 0 };
  }
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens > 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}
