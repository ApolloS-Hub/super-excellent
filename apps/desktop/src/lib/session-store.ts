/**
 * Session Persistence — IndexedDB backend for conversations
 *
 * Centralized persistence layer. Messages use structured content blocks
 * (text + tool_use + tool_result + thinking) serialized as JSON arrays.
 *
 * On conversation switch, messages load from DB — not React state.
 */

const DB_NAME = "super-excellent";
const DB_VERSION = 2;
const STORE_NAME = "conversations";

// ── Structured content blocks (CodePilot-inspired) ──────────────

export type MessageBlockType = "text" | "tool_use" | "tool_result" | "thinking";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: string; // JSON string of parameters
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
}

export type MessageBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// ── Conversation record ─────────────────────────────────────────

interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
  provider?: string;
  model?: string;
}

// ── DB access ───────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── CRUD ────────────────────────────────────────────────────────

export async function loadAllConversations(): Promise<ConversationRecord[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("updatedAt");
      const request = index.getAll();
      request.onsuccess = () => {
        const results = (request.result as ConversationRecord[])
          .sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Fallback to localStorage
    try {
      const raw = localStorage.getItem("conversations");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export async function saveConversation(conv: ConversationRecord): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback: save to localStorage
    const all = await loadAllConversations();
    const idx = all.findIndex(c => c.id === conv.id);
    if (idx >= 0) all[idx] = conv;
    else all.push(conv);
    localStorage.setItem("conversations", JSON.stringify(all.slice(0, 100)));
  }
}

export async function deleteConversationDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

// ── Direct message access by conversation ID ────────────────────

/** Load messages for a single conversation from DB. Returns empty array if not found. */
export async function loadMessagesForConversation(convId: string): Promise<unknown[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(convId);
      request.onsuccess = () => {
        const record = request.result as ConversationRecord | undefined;
        resolve(record?.messages ?? []);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Fallback
    try {
      const raw = localStorage.getItem("conversations");
      if (!raw) return [];
      const convs = JSON.parse(raw) as ConversationRecord[];
      return convs.find(c => c.id === convId)?.messages ?? [];
    } catch {
      return [];
    }
  }
}

/** Save messages for a specific conversation, updating timestamp. */
export async function saveMessagesForConversation(
  convId: string,
  messages: unknown[],
  title?: string,
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(convId);
      getReq.onsuccess = () => {
        const existing = getReq.result as ConversationRecord | undefined;
        if (existing) {
          existing.messages = messages;
          existing.updatedAt = Date.now();
          if (title) existing.title = title;
          store.put(existing);
        }
        tx.oncomplete = () => resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* fallback handled by caller */
  }
}

// ── Serialization: ChatMessage ↔ structured blocks ──────────────

/** Convert a ChatMessage's content + toolCalls into JSON array of MessageBlocks */
export function serializeMessageContent(msg: {
  content: string;
  toolCalls?: Array<{ name: string; input: string; output?: string; status?: string }>;
}): string {
  const blocks: MessageBlock[] = [];

  // Parse thinking out of content (emoji-prefixed lines)
  const thinkingMatch = msg.content.match(/^([\s\S]*?)((?:\n?(?:🔄|📦|✅|❌|💭|💰)[\s\S]*?)*)$/);
  const mainText = thinkingMatch?.[1]?.trim() || msg.content;
  const thinkingText = thinkingMatch?.[2]?.trim() || "";

  if (thinkingText) {
    blocks.push({ type: "thinking", text: thinkingText });
  }

  // Tool calls as tool_use + tool_result pairs
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      const toolId = `tool_${tc.name}_${Date.now()}`;
      blocks.push({ type: "tool_use", id: toolId, name: tc.name, input: tc.input });
      if (tc.output !== undefined) {
        blocks.push({
          type: "tool_result",
          tool_use_id: toolId,
          content: tc.output,
          is_error: tc.status === "error",
        });
      }
    }
  }

  if (mainText) {
    blocks.push({ type: "text", text: mainText });
  }

  return JSON.stringify(blocks);
}

/** Deserialize structured blocks back to content string + toolCalls */
export function deserializeMessageContent(serialized: string): {
  content: string;
  toolCalls: Array<{ name: string; input: string; output?: string; status?: "running" | "success" | "error" }>;
} {
  try {
    const blocks = JSON.parse(serialized) as MessageBlock[];
    let content = "";
    let thinking = "";
    const toolCalls: Array<{ name: string; input: string; output?: string; status?: "running" | "success" | "error" }> = [];
    const toolResultMap = new Map<string, { content: string; is_error?: boolean }>();

    // First pass: collect tool results
    for (const block of blocks) {
      if (block.type === "tool_result") {
        toolResultMap.set(block.tool_use_id, { content: block.content, is_error: block.is_error });
      }
    }

    // Second pass: build output
    for (const block of blocks) {
      switch (block.type) {
        case "text":
          content += block.text;
          break;
        case "thinking":
          thinking = block.text;
          break;
        case "tool_use": {
          const result = toolResultMap.get(block.id);
          toolCalls.push({
            name: block.name,
            input: block.input,
            output: result?.content,
            status: result?.is_error ? "error" : result ? "success" : "running",
          });
          break;
        }
      }
    }

    // Append thinking back if present
    if (thinking) {
      content = content ? `${content}\n${thinking}` : thinking;
    }

    return { content, toolCalls };
  } catch {
    // Not structured format — treat as plain text
    return { content: serialized, toolCalls: [] };
  }
}

// ── Migration ───────────────────────────────────────────────────

export async function migrateFromLocalStorage(): Promise<boolean> {
  try {
    const raw = localStorage.getItem("conversations");
    if (!raw) return false;
    const convs = JSON.parse(raw) as ConversationRecord[];
    if (!convs.length) return false;

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const conv of convs) {
      store.put(conv);
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        localStorage.removeItem("conversations");
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Export all conversations as JSON string */
export async function exportAllConversations(): Promise<string> {
  const all = await loadAllConversations();
  return JSON.stringify(all, null, 2);
}

/** Import conversations from JSON string */
export async function importConversations(json: string): Promise<number> {
  const convs = JSON.parse(json) as ConversationRecord[];
  let count = 0;
  for (const conv of convs) {
    await saveConversation(conv);
    count++;
  }
  return count;
}
