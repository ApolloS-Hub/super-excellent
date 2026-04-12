/**
 * Three-tier Memory System
 *
 * Short-term: Ring buffer (max 20), current session only, no persistence.
 * Mid-term:   IndexedDB, user preferences / frequent paths / commands, 30-day TTL.
 * Long-term:  local persisted memory + semantic retrieval in agent-core.
 */

import i18n from "../i18n";
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ────────────────────────── Types ──────────────────────────

export interface MemoryEntry {
  content: string;
  timestamp: number;
  source: "user" | "auto" | "project";
  tags?: string[];
}

export interface MidTermRecord {
  id: string;
  category: "preference" | "path" | "command" | "pattern" | "style";
  content: string;
  frequency: number;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

// ────────────────────────── Constants ──────────────────────────

const SHORT_TERM_CAP = 20;
const MID_TERM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IDB_NAME = "super-excellent-memory";
const IDB_VERSION = 1;
const IDB_STORE = "midterm";
const MEMORY_KEY = "user-memory";
const MAX_MEMORY_LINES = 200;
const MAX_MEMORY_BYTES = 25000;

// ────────────────────────── Short-term Memory ──────────────────────────

const shortTermBuffer: MemoryEntry[] = [];

export function pushShortTerm(entry: MemoryEntry): void {
  shortTermBuffer.push(entry);
  if (shortTermBuffer.length > SHORT_TERM_CAP) {
    shortTermBuffer.shift();
  }
}

export function getShortTermContext(): MemoryEntry[] {
  return shortTermBuffer.slice();
}

export function clearShortTerm(): void {
  shortTermBuffer.length = 0;
}

export function buildShortTermSummary(): string {
  if (shortTermBuffer.length === 0) return "";
  const lines = shortTermBuffer.map((e) => {
    const tag = e.tags?.length ? ` [${e.tags.join(",")}]` : "";
    return `- ${e.content}${tag}`;
  });
  return lines.join("\n");
}

// ────────────────────────── Mid-term Memory (IndexedDB) ──────────────────────────

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
        const store = db.createObjectStore(IDB_STORE, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
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

export async function saveMidTerm(record: Omit<MidTermRecord, "id" | "createdAt" | "lastAccessedAt" | "expiresAt" | "frequency">): Promise<void> {
  const { store, done } = await idbTx("readwrite");
  const now = Date.now();
  const id = `${record.category}:${hashString(record.content)}`;
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const existing = getReq.result as MidTermRecord | undefined;
    if (existing) {
      existing.frequency += 1;
      existing.lastAccessedAt = now;
      existing.expiresAt = now + MID_TERM_TTL_MS;
      store.put(existing);
    } else {
      const entry: MidTermRecord = {
        id,
        category: record.category,
        content: record.content,
        frequency: 1,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + MID_TERM_TTL_MS,
      };
      store.put(entry);
    }
  };
  await done;
}

export async function queryMidTerm(category?: MidTermRecord["category"]): Promise<MidTermRecord[]> {
  try {
    const { store, done } = await idbTx("readonly");
    const results: MidTermRecord[] = [];
    const now = Date.now();

    const cursor = category
      ? store.index("category").openCursor(IDBKeyRange.only(category))
      : store.openCursor();

    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        const rec = c.value as MidTermRecord;
        if (rec.expiresAt > now) {
          results.push(rec);
        }
        c.continue();
      }
    };
    await done;
    return results.sort((a, b) => b.frequency - a.frequency);
  } catch {
    return [];
  }
}

export async function pruneExpiredMidTerm(): Promise<number> {
  try {
    const { store, done } = await idbTx("readwrite");
    let pruned = 0;
    const now = Date.now();
    const cursor = store.index("expiresAt").openCursor(IDBKeyRange.upperBound(now));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        c.delete();
        pruned++;
        c.continue();
      }
    };
    await done;
    return pruned;
  } catch {
    return 0;
  }
}

export async function clearMidTerm(): Promise<void> {
  const { store, done } = await idbTx("readwrite");
  store.clear();
  await done;
}

export async function buildMidTermSummary(): Promise<string> {
  const records = await queryMidTerm();
  if (records.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const r of records) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r.content + (r.frequency > 1 ? ` (×${r.frequency})` : ""));
  }

  const sections: string[] = [];
  const labels: Record<string, string> = {
    preference: t("memory.catPreference"),
    path: t("memory.catPath"),
    command: t("memory.catCommand"),
    pattern: t("memory.catPattern"),
    style: t("memory.catStyle"),
  };
  for (const [cat, items] of Object.entries(grouped)) {
    sections.push(`### ${labels[cat] || cat}\n${items.map((i) => `- ${i}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

// ────────────────────────── Long-term Memory (persistent local store) ──────────────────────────

export function loadMemory(): string {
  try {
    return localStorage.getItem(MEMORY_KEY) || "";
  } catch {
    return "";
  }
}

export function saveMemory(content: string): void {
  const lines = content.split("\n");
  let truncated = content;
  if (lines.length > MAX_MEMORY_LINES) {
    truncated = lines.slice(0, MAX_MEMORY_LINES).join("\n") + `\n\n[...${t("memory.truncated")}]`;
  }
  if (truncated.length > MAX_MEMORY_BYTES) {
    truncated = truncated.slice(0, MAX_MEMORY_BYTES) + `\n\n[...${t("memory.truncated")}]`;
  }
  localStorage.setItem(MEMORY_KEY, truncated);
}

export function appendMemory(entry: string): void {
  const existing = loadMemory();
  const timestamp = new Date().toISOString().split("T")[0];
  const newContent = existing
    ? `${existing}\n- [${timestamp}] ${entry}`
    : `# ${t("memory.userMemoryHeader")}\n\n- [${timestamp}] ${entry}`;
  saveMemory(newContent);
}

export function searchMemory(query: string): string[] {
  const content = loadMemory();
  if (!content) return [];
  const lines = content.split("\n").filter((l) => l.trim());
  const queryWords = query.toLowerCase().split(/\s+/);
  return lines.filter((line) => {
    const lower = line.toLowerCase();
    return queryWords.some((w) => lower.includes(w));
  });
}

export function buildMemoryPrompt(): string {
  const content = loadMemory();
  if (!content) return "";
  return `\n\n## ${t("memory.userMemoryHeader")}\n${t("memory.memoryPromptHint")}\n${content}`;
}

export function formatMemory(): string {
  const content = loadMemory();
  if (!content) return `📭 ${t("memory.noMemory")}`;
  const lines = content.split("\n").filter((l) => l.trim());
  return `📝 ${t("memory.memoryCount", { count: lines.length })}\n\n${content}`;
}

// ────────────────────────── Auto-learn (extracts patterns into mid-term) ──────────────────────────

export function autoLearn(userMessage: string, _assistantResponse?: string): void {
  if (/请用英文/.test(userMessage)) {
    appendMemory(t("memory.prefReplyEnglish"));
    void saveMidTerm({ category: "preference", content: t("memory.prefReplyEnglish") });
  }
  if (/用中文/.test(userMessage)) {
    appendMemory(t("memory.prefReplyChinese"));
    void saveMidTerm({ category: "preference", content: t("memory.prefReplyChinese") });
  }

  const pathMatch = userMessage.match(/(?:项目|project).*?([/~][\w/.-]+)/);
  if (pathMatch) {
    appendMemory(`${t("memory.commonProjectPath")}: ${pathMatch[1]}`);
    void saveMidTerm({ category: "path", content: pathMatch[1] });
  }

  if (/不要用.*?bash/i.test(userMessage)) {
    appendMemory(t("memory.prefAvoidBash"));
    void saveMidTerm({ category: "preference", content: t("memory.prefAvoidBash") });
  }
  if (/直接执行/.test(userMessage)) {
    appendMemory(t("memory.prefDirectExec"));
    void saveMidTerm({ category: "preference", content: t("memory.prefDirectExec") });
  }
}

// ────────────────────────── Composite context builder ──────────────────────────

export async function buildFullMemoryContext(): Promise<string> {
  const parts: string[] = [];

  const shortTerm = buildShortTermSummary();
  if (shortTerm) {
    parts.push(`## ${t("memory.currentSessionContext")}\n${shortTerm}`);
  }

  const midTerm = await buildMidTermSummary();
  if (midTerm) {
    parts.push(`## ${t("memory.userPrefsAndHabits")}\n${midTerm}`);
  }

  const longTerm = loadMemory();
  if (longTerm) {
    parts.push(`## ${t("memory.longTermMemory")}\n${longTerm}`);
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}

// ────────────────────────── Helpers ──────────────────────────

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
