import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe("permission-engine", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "localStorage", {
      value: new LocalStorageMock(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows safe read tools by default", async () => {
    const { permissionEngine } = await import("./permission-engine");
    expect(permissionEngine.checkPermission("file_read", { path: "/tmp/a.txt" })).toBe("allow");
    expect(permissionEngine.checkPermission("grep", { pattern: "foo" })).toBe("allow");
  });

  it("asks for writes in default mode", async () => {
    const { permissionEngine } = await import("./permission-engine");
    permissionEngine.setLevel("default");
    expect(permissionEngine.checkPermission("file_write", { path: "/tmp/a.txt" })).toBe("ask");
    expect(permissionEngine.checkPermission("bash", { command: "echo hi" })).toBe("ask");
  });

  it("auto-allows safe file edits in dontAsk mode but still asks for dangerous bash", async () => {
    const { permissionEngine } = await import("./permission-engine");
    permissionEngine.setLevel("dontAsk");

    expect(permissionEngine.checkPermission("file_edit", { path: "/tmp/project/file.ts" })).toBe("allow");
    expect(permissionEngine.checkPermission("bash", { command: "echo safe" })).toBe("allow");
    expect(permissionEngine.checkPermission("bash", { command: "rm -rf /tmp/foo" })).toBe("ask");
  });

  it("respects remembered rules and denial analytics", async () => {
    const { permissionEngine } = await import("./permission-engine");
    permissionEngine.clearRules();
    permissionEngine.clearDenials();
    permissionEngine.rememberRule({ tool: "file_write", path: "/tmp/allowed/*", action: "allow" });

    expect(permissionEngine.checkPermission("file_write", { path: "/tmp/allowed/demo.txt" })).toBe("allow");

    permissionEngine.trackDenial("bash", "dangerous command");
    permissionEngine.trackDenial("bash", "dangerous command");
    permissionEngine.trackDenial("file_write", "sensitive path", "/etc/passwd");

    const stats = permissionEngine.getDenialStats();
    expect(stats[0].tool).toBe("bash");
    expect(stats[0].count).toBe(2);
    expect(stats.some((item) => item.tool === "file_write")).toBe(true);
  });

  it("blocks everything in plan mode", async () => {
    const { permissionEngine } = await import("./permission-engine");
    permissionEngine.setLevel("plan");
    expect(permissionEngine.checkPermission("file_write", { path: "/tmp/a.txt" })).toBe("deny");
  });
});
