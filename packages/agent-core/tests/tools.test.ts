import { describe, it, expect, vi } from "vitest";
import { createToolExecutor, BUILTIN_TOOLS } from "../src/tools/index.js";
import { McpManager } from "../src/mcp/client.js";
import { _stripHtml, _extractTitle } from "../src/tools/builtin/browser.js";

describe("Built-in Tools", () => {
  it("should have 13 tools", () => {
    expect(BUILTIN_TOOLS).toHaveLength(13);
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
    expect(names).toContain("BrowserFetch");
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
    expect(readOnly).toContain("BrowserFetch");
    expect(readOnly).not.toContain("Bash");
    expect(readOnly).not.toContain("Write");
  });

  it("should execute Read tool", async () => {
    const executor = createToolExecutor();
    // Read this test file itself
    const { fileURLToPath } = await import("node:url");
    const thisFile = fileURLToPath(import.meta.url);
    const result = await executor.execute("Read", { path: thisFile });
    expect(result).toContain("describe");
  });

  it("should deny unknown tools", async () => {
    const executor = createToolExecutor();
    const result = await executor.execute("FakeToolXYZ", {});
    expect(result).toContain("Unknown tool");
  });
});

describe("BrowserFetch helpers", () => {
  it("stripHtml removes script and style tags", () => {
    const html = `<html><head><style>body{color:red}</style></head>
      <body><script>alert(1)</script><p>Hello world</p></body></html>`;
    const text = _stripHtml(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).toContain("Hello world");
  });

  it("extractTitle returns the page title", () => {
    expect(_extractTitle("<html><head><title>My Page</title></head></html>")).toBe("My Page");
  });

  it("extractTitle returns empty string when no title", () => {
    expect(_extractTitle("<html><body>no title</body></html>")).toBe("");
  });

  it("BrowserFetch returns title + body for valid HTML", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;

    // Mock global fetch
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "text/html"]]),
      text: async () =>
        `<html><head><title>Test Page</title></head>
         <body><script>evil()</script><p>Some content here</p></body></html>`,
    });
    // Add get method to headers
    fakeFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: { get: (k: string) => k === "content-type" ? "text/html" : null },
      text: async () =>
        `<html><head><title>Test Page</title></head>
         <body><script>evil()</script><p>Some content here</p></body></html>`,
    }));
    vi.stubGlobal("fetch", fakeFetch);

    const result = await tool.execute({ url: "https://example.com" });
    expect(result).toContain("Test Page");
    expect(result).toContain("Some content here");
    expect(result).not.toContain("evil");

    vi.unstubAllGlobals();
  });

  it("BrowserFetch extracts links when requested", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => k === "content-type" ? "text/html" : null },
      text: async () =>
        `<html><head><title>Links Page</title></head>
         <body><a href="https://example.com/page1">Page 1</a><a href="/page2">Page 2</a></body></html>`,
    }));

    const result = await tool.execute({ url: "https://example.com", extractLinks: true });
    expect(result).toContain("Links");
    expect(result).toContain("Page 1");

    vi.unstubAllGlobals();
  });

  it("BrowserFetch extracts meta description", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => k === "content-type" ? "text/html" : null },
      text: async () =>
        `<html><head><title>Meta Page</title><meta name="description" content="A great page about AI"></head>
         <body>Content here</body></html>`,
    }));

    const result = await tool.execute({ url: "https://example.com" });
    expect(result).toContain("A great page about AI");

    vi.unstubAllGlobals();
  });

  it("BrowserFetch respects maxChars", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;
    const longBody = "A".repeat(10000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => k === "content-type" ? "text/html" : null },
      text: async () => `<html><body>${longBody}</body></html>`,
    }));

    const result = await tool.execute({ url: "https://example.com", maxChars: 100 });
    // Body text portion should not exceed maxChars significantly
    expect(result.length).toBeLessThan(200); // title/metadata adds some overhead

    vi.unstubAllGlobals();
  });

  it("BrowserFetch handles HTTP errors", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
    }));

    const result = await tool.execute({ url: "https://example.com/nope" });
    expect(result).toBe("HTTP 404: Not Found");

    vi.unstubAllGlobals();
  });

  it("BrowserFetch handles fetch errors", async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === "BrowserFetch")!;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await tool.execute({ url: "https://example.com" });
    expect(result).toContain("Error fetching URL");
    expect(result).toContain("network down");

    vi.unstubAllGlobals();
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
    expect(manager.getServerNames()).toEqual([]);
    await manager.disconnectAll();
  });
});
