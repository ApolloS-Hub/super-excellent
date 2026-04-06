/**
 * Session Persistence — IndexedDB backend for conversations
 * Replaces localStorage with unlimited storage, handles large conversations
 */

const DB_NAME = "super-excellent";
const DB_VERSION = 1;
const STORE_NAME = "conversations";

interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
  provider?: string;
  model?: string;
}

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
