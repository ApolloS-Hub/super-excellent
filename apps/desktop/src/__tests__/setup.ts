/**
 * Test setup — mocks for Tauri, localStorage, indexedDB, and browser globals
 *
 * Provides an isolated environment for testing desktop app logic
 * without Tauri runtime or browser APIs.
 */
import { vi } from "vitest";

// ═══════════ @tauri-apps/plugin-updater mock ═══════════

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

// ═══════════ @tauri-apps/api mocks ═══════════

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}));

// ═══════════ Tauri internals noop mock ═══════════

(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: vi.fn().mockResolvedValue(null),
  transformCallback: vi.fn().mockReturnValue(0),
  convertFileSrc: vi.fn((src: string) => src),
  metadata: { currentWebview: { label: "main" } },
};

// ═══════════ In-memory localStorage mock ═══════════

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      const keys = [...store.keys()];
      return keys[index] ?? null;
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  value: createLocalStorageMock(),
  writable: true,
  configurable: true,
});

// ═══════════ IndexedDB noop mock ═══════════

function createIndexedDBMock() {
  const noop = () => {};

  const mockObjectStore = {
    put: vi.fn(),
    get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, result: undefined }),
    delete: vi.fn(),
    clear: vi.fn(),
    count: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, result: 0 }),
    openCursor: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, result: null }),
    createIndex: vi.fn(),
    index: vi.fn().mockReturnValue({
      openCursor: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, result: null }),
    }),
  };

  const mockTransaction = {
    objectStore: vi.fn().mockReturnValue(mockObjectStore),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };

  const mockDB = {
    transaction: vi.fn().mockImplementation(() => {
      // Auto-complete transactions on next tick
      setTimeout(() => {
        if (mockTransaction.oncomplete) mockTransaction.oncomplete();
      }, 0);
      return mockTransaction;
    }),
    objectStoreNames: { contains: vi.fn().mockReturnValue(false) },
    createObjectStore: vi.fn().mockReturnValue(mockObjectStore),
    close: vi.fn(),
  };

  const mockIDB = {
    open: vi.fn().mockImplementation(() => {
      const req = {
        result: mockDB,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }),
    deleteDatabase: vi.fn(),
  };

  return mockIDB;
}

Object.defineProperty(globalThis, "indexedDB", {
  value: createIndexedDBMock(),
  writable: true,
  configurable: true,
});

// ═══════════ window mock (for health-monitor's window.indexedDB check) ═══════════

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}
