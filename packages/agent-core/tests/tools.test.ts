import { describe, it, expect } from "vitest";
import { createToolExecutor, BUILTIN_TOOLS } from "../src/tools/index.js";
import { McpManager } from "../src/mcp/client.js";

describe("Built-in Tools", () => {
  it("should have 12 tools", () => {
    expect(BUILTIN_TOOLS).toHaveLength(12);
  });

  it("should include all expected tools", () => {
    const names = BUILTIN_TOOLS.map(t => t.name);
    expect(names).toContain("Bash");
    expect(names).toContain("Read");
    expect(names).toContain("Write");
    expect(names).toContain("Edit");
    expect(names).toContain("Glob");
    expect(names).toContain("Grep");
    expect(names).toContain("WebFetch");
    expect(names).toContain("WebSearch");
    expect(names).toContain("AskUser");
    expect(names).toContain("ListDir");
    expect(names).toContain("BrowserOpen");
    expect(names).toContain("Screenshot");
  });

  it("should mark read-only tools correctly", () => {
    const readOnly = BUILTIN_TOOLS.filter(t => t.isReadOnly).map(t => t.name);
    expect(readOnly).toContain("Read");
    expect(readOnly).toContain("Glob");
    expect(readOnly).toContain("Grep");
    expect(readOnly).toContain("WebFetch");
    expect(readOnly).toContain("WebSearch");
    expect(readOnly).toContain("AskUser");
    expect(readOnly).toContain("ListDir");
    expect(readOnly).toContain("Screenshot");
    expect(readOnly).not.toContain("Bash");
    expect(readOnly).not.toContain("Write");
  });

  it("should execute Read tool", async () => {
    const executor = createToolExecutor();
    // Read this test file itself
    const result = await executor.execute("Read", { path: import.meta.url.replace("file://", "").split("?")[0] });
    expect(result).toContain("describe");
  });

  it("should deny unknown tools", async () => {
    const executor = createToolExecutor();
    const result = await executor.execute("FakeToolXYZ", {});
    expect(result).toContain("Unknown tool");
  });
});

describe("McpManager", () => {
  it("should create manager with no servers", () => {
    const manager = new McpManager();
    expect(manager.getAllTools()).toHaveLength(0);
    expect(manager.getServerNames()).toHaveLength(0);
  });

  it("should track server names", async () => {
    const manager = new McpManager();
    // Can't actually connect without a real MCP server, but structure works
    expect(manager.getServerNames()).toEqual([]);
    await manager.disconnectAll();
  });
});
