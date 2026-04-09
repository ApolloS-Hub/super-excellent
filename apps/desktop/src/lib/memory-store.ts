/**
 * Memory Store — Cross-session persistent memory with IndexedDB
 * Aligned with ref-s09 memory system pattern.
 */

// ═══════════ Types ═══════════

export type MemoryCategory = "preference" | "fact" | "project" | "instruction";

export interface MemoryEntry {
  key: string;
  content: string;
  category: MemoryCategory;
  timestamp: number;
  accessCount: number;
}

// ═══════════ Constants ═══════════

const IDB_NAME = "super-excellent-memory-store";
const IDB_VERSION = 1;
const IDB_STORE = "memories";

// ═══════════ IndexedDB Helpers ═══════════

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "key" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(
  mode: IDBTransactionMode,
): Promise<{ store: IDBObjectStore; done: Promise<void> }> {
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

// ═══════════ MemoryStore ═══════════

export class MemoryStore {
  /** Save a memory entry (upsert by key) */
  async save(entry: Omit<MemoryEntry, "timestamp" | "accessCount"> & { timestamp?: number; accessCount?: number }): Promise<void> {
    const { store, done } = await idbTx("readwrite");
    const record: MemoryEntry = {
      key: entry.key,
      content: entry.content,
      category: entry.category,
      timestamp: entry.timestamp ?? Date.now(),
      accessCount: entry.accessCount ?? 0,
    };
    store.put(record);
    await done;
  }

  /** Load all memory entries, optionally filtered by category */
  async load(category?: MemoryCategory): Promise<MemoryEntry[]> {
    try {
      const { store, done } = await idbTx("readonly");
      const results: MemoryEntry[] = [];

      const cursor = category
        ? store.index("category").openCursor(IDBKeyRange.only(category))
        : store.openCursor();

      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          results.push(c.value as MemoryEntry);
          c.continue();
        }
      };
      await done;
      return results.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /** Search memories by content keyword */
  async search(query: string): Promise<MemoryEntry[]> {
    const all = await this.load();
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter(entry => {
      const text = `${entry.key} ${entry.content} ${entry.category}`.toLowerCase();
      return terms.some(t => text.includes(t));
    });
  }

  /** Remove a memory by key */
  async remove(key: string): Promise<void> {
    const { store, done } = await idbTx("readwrite");
    store.delete(key);
    await done;
  }

  /** Prune old memories beyond a max count, keeping most recent */
  async prune(maxCount = 200): Promise<number> {
    const all = await this.load();
    if (all.length <= maxCount) return 0;

    // Sort by timestamp ascending (oldest first)
    const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = sorted.slice(0, all.length - maxCount);

    const { store, done } = await idbTx("readwrite");
    for (const entry of toRemove) {
      store.delete(entry.key);
    }
    await done;
    return toRemove.length;
  }

  /** Increment access count for a memory */
  async touch(key: string): Promise<void> {
    try {
      const { store, done } = await idbTx("readwrite");
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const entry = getReq.result as MemoryEntry | undefined;
        if (entry) {
          entry.accessCount += 1;
          store.put(entry);
        }
      };
      await done;
    } catch { /* ignore */ }
  }

  /** Get count of stored memories */
  async count(): Promise<number> {
    try {
      const { store, done } = await idbTx("readonly");
      const countReq = store.count();
      let result = 0;
      countReq.onsuccess = () => { result = countReq.result; };
      await done;
      return result;
    } catch {
      return 0;
    }
  }

  /** Build a prompt section from recent memories for system prompt injection */
  async buildPromptSection(maxEntries = 20): Promise<string> {
    const entries = await this.load();
    if (entries.length === 0) return "";

    const recent = entries.slice(0, maxEntries);
    const grouped: Record<string, string[]> = {};
    const labels: Record<MemoryCategory, string> = {
      preference: "用户偏好",
      fact: "已知事实",
      project: "项目信息",
      instruction: "指令",
    };

    for (const e of recent) {
      const cat = labels[e.category] || e.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`- ${e.content}`);
    }

    const sections: string[] = [];
    for (const [label, items] of Object.entries(grouped)) {
      sections.push(`### ${label}\n${items.join("\n")}`);
    }
    return sections.join("\n\n");
  }
}

/** Global singleton */
export const memoryStore = new MemoryStore();
