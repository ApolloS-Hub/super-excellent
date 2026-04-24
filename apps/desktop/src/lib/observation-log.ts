/**
 * Observation Log — Auto-captured observations with progressive disclosure retrieval.
 *
 * Inspired by claude-mem's PostToolUse hook + 3-layer search architecture.
 * Subscribes to the event bus, auto-captures meaningful events, supports
 * <private> tag filtering, deduplicates via Jaccard similarity, and exposes
 * 3-layer retrieval: search (compact index) → timeline → getObservations.
 *
 * Storage: IndexedDB (same backend as memory-store).
 */
import { onAgentEvent } from "./event-bus";

// ═══════════ Types ═══════════

export type ObservationType = "tool_use" | "tool_result" | "user_message" | "assistant_result" | "worker_dispatch" | "decision";

export interface Observation {
  id: string;
  timestamp: number;
  type: ObservationType;
  summary: string;        // compact, for index layer (< 120 chars)
  detail: string;         // full content, for get layer
  conversationId?: string;
  worker?: string;
  tags: string[];
  accessCount: number;
}

export interface SearchResultEntry {
  id: string;
  summary: string;
  timestamp: number;
  type: ObservationType;
  worker?: string;
}

// ═══════════ Constants ═══════════

const IDB_NAME = "super-excellent-observations";
const IDB_VERSION = 1;
const IDB_STORE = "observations";
const MAX_OBSERVATIONS = 2000;
const DEDUP_THRESHOLD = 0.85;
const SUMMARY_MAX = 120;

// ═══════════ IndexedDB ═══════════

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB not available")); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; done: Promise<void> }> {
  return openDB().then((db) => {
    const tx = db.transaction(IDB_STORE, mode);
    const store = tx.objectStore(IDB_STORE);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    return { store, done };
  });
}

// ═══════════ Privacy filter ═══════════

const PRIVATE_TAG = /<private>([\s\S]*?)<\/private>/g;

export function stripPrivate(text: string): string {
  return text.replace(PRIVATE_TAG, "[redacted]");
}

export function hasPrivateTag(text: string): boolean {
  return PRIVATE_TAG.test(text);
}

// ═══════════ Jaccard similarity for dedup ═══════════

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\w一-鿿]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1),
  );
}

function jaccard(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokA) if (tokB.has(t)) intersection++;
  const union = tokA.size + tokB.size - intersection;
  return intersection / union;
}

// ═══════════ Summarization ═══════════

function summarize(_type: ObservationType, detail: string, worker?: string): string {
  const trimmed = detail.trim().replace(/\s+/g, " ");
  const prefix = worker ? `[${worker}] ` : "";
  const maxContent = SUMMARY_MAX - prefix.length - 2;
  const body = trimmed.length > maxContent ? trimmed.slice(0, maxContent) + "…" : trimmed;
  return `${prefix}${body}`;
}

// ═══════════ ObservationLog ═══════════

export class ObservationLog {
  async save(obs: Omit<Observation, "id" | "timestamp" | "accessCount" | "summary"> & { summary?: string }): Promise<string | null> {
    // Privacy filter
    if (hasPrivateTag(obs.detail)) {
      obs.detail = stripPrivate(obs.detail);
    }
    if (!obs.detail.trim()) return null;

    const summary = obs.summary || summarize(obs.type, obs.detail, obs.worker);

    // Dedup check against recent observations of the same type
    const recent = await this.loadRecent(50);
    for (const existing of recent) {
      if (existing.type !== obs.type) continue;
      if (jaccard(existing.detail, obs.detail) >= DEDUP_THRESHOLD) {
        // Just bump access count + timestamp
        existing.accessCount++;
        existing.timestamp = Date.now();
        await this.put(existing);
        return existing.id;
      }
    }

    const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: Observation = {
      id,
      timestamp: Date.now(),
      type: obs.type,
      summary,
      detail: obs.detail,
      conversationId: obs.conversationId,
      worker: obs.worker,
      tags: obs.tags || [],
      accessCount: 0,
    };

    await this.put(record);
    await this.pruneIfNeeded();
    return id;
  }

  private async put(record: Observation): Promise<void> {
    const { store, done } = await idbTx("readwrite");
    store.put(record);
    return done;
  }

  async loadAll(): Promise<Observation[]> {
    const { store, done } = await idbTx("readonly");
    return new Promise<Observation[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => { done.then(() => resolve(req.result as Observation[])); };
      req.onerror = () => reject(req.error);
    });
  }

  async loadRecent(limit: number): Promise<Observation[]> {
    const all = await this.loadAll();
    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async pruneIfNeeded(): Promise<void> {
    const all = await this.loadAll();
    if (all.length <= MAX_OBSERVATIONS) return;
    // Keep newest + most-accessed (weighted)
    const scored = all.map(o => ({ o, score: o.accessCount * 10 + (o.timestamp / 1e9) }));
    scored.sort((a, b) => b.score - a.score);
    const toRemove = scored.slice(MAX_OBSERVATIONS).map(s => s.o.id);
    const { store, done } = await idbTx("readwrite");
    for (const id of toRemove) store.delete(id);
    await done;
  }

  async clear(): Promise<void> {
    const { store, done } = await idbTx("readwrite");
    store.clear();
    return done;
  }

  // ── L1: Search — compact index ──

  async search(query: string, limit = 20): Promise<SearchResultEntry[]> {
    const all = await this.loadAll();
    if (!query.trim()) {
      return all
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map(o => ({ id: o.id, summary: o.summary, timestamp: o.timestamp, type: o.type, worker: o.worker }));
    }
    const q = query.toLowerCase();
    const qTokens = tokenize(query);

    const scored = all.map(o => {
      const text = (o.summary + " " + o.detail + " " + (o.tags || []).join(" ")).toLowerCase();
      let score = 0;
      // Substring hit (high weight)
      if (text.includes(q)) score += 10;
      // Token overlap
      const oTokens = tokenize(text);
      for (const t of qTokens) if (oTokens.has(t)) score += 1;
      // Recency tiebreaker
      score += Math.max(0, 1 - (Date.now() - o.timestamp) / (30 * 86400_000));
      return { o, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => ({
      id: s.o.id, summary: s.o.summary, timestamp: s.o.timestamp, type: s.o.type, worker: s.o.worker,
    }));
  }

  // ── L2: Timeline — chronological context around a conversation or observation ──

  async timeline(conversationId: string, limit = 30): Promise<Observation[]> {
    const all = await this.loadAll();
    return all
      .filter(o => o.conversationId === conversationId)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);
  }

  async timelineAround(obsId: string, windowMin = 30): Promise<Observation[]> {
    const all = await this.loadAll();
    const center = all.find(o => o.id === obsId);
    if (!center) return [];
    const windowMs = windowMin * 60_000;
    return all
      .filter(o => Math.abs(o.timestamp - center.timestamp) <= windowMs)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ── L3: Get observations — full details ──

  async getObservations(ids: string[]): Promise<Observation[]> {
    const all = await this.loadAll();
    const byId = new Map(all.map(o => [o.id, o]));
    const found: Observation[] = [];
    for (const id of ids) {
      const obs = byId.get(id);
      if (obs) {
        obs.accessCount++;
        await this.put(obs);
        found.push(obs);
      }
    }
    return found;
  }

  // ── Summary for prompt injection ──

  async buildCompactIndex(limit = 10): Promise<string> {
    const recent = await this.loadRecent(limit);
    if (recent.length === 0) return "";
    const lines = recent.map(o => {
      const ago = formatAgo(o.timestamp);
      return `- [${o.id}] ${ago} · ${o.summary}`;
    });
    return `# Recent Observations (${recent.length})\n${lines.join("\n")}\n\n> Use \`/recall <keyword>\` to search; use \`/recall-details <id>\` to fetch full detail.`;
  }
}

function formatAgo(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ═══════════ Singleton ═══════════

export const observationLog = new ObservationLog();

// ═══════════ Auto-capture via event bus ═══════════

let _autoCapture = false;
let _currentConversationId: string | undefined;

export function setCurrentConversationId(id: string | undefined): void {
  _currentConversationId = id;
  // Also expose globally for cost-quota check in coordinator (which can't import observation-log sync)
  (globalThis as Record<string, unknown>).__currentConversationId = id;
}

export function startAutoCapture(): void {
  if (_autoCapture) return;
  _autoCapture = true;

  onAgentEvent((event) => {
    const type = (event.type as string) || "unknown";
    let obsType: ObservationType | null = null;
    let detail = "";

    switch (type) {
      case "tool_use": {
        obsType = "tool_use";
        const toolName = event.toolName as string || event.name as string || "";
        const input = event.toolInput || event.input;
        const inputStr = typeof input === "string" ? input : JSON.stringify(input);
        detail = `${toolName}(${inputStr.slice(0, 200)})`;
        break;
      }
      case "tool_result": {
        obsType = "tool_result";
        detail = (event.toolOutput as string || event.output as string || "").slice(0, 400);
        break;
      }
      case "user_message": {
        obsType = "user_message";
        detail = (event.text as string) || "";
        break;
      }
      case "result": {
        obsType = "assistant_result";
        detail = (event.text as string) || "";
        break;
      }
      case "worker_dispatch": {
        obsType = "worker_dispatch";
        detail = `Dispatched to ${event.worker}: ${(event.text as string) || (event.plan as string) || ""}`;
        break;
      }
    }

    if (!obsType || !detail.trim() || detail.length < 10) return;

    // Save asynchronously, don't block events
    observationLog.save({
      type: obsType,
      detail,
      worker: event.worker as string | undefined,
      conversationId: _currentConversationId,
      tags: [],
    }).catch(() => { /* quota or IDB failure — skip */ });
  });
}

export function stopAutoCapture(): void {
  _autoCapture = false;
}
