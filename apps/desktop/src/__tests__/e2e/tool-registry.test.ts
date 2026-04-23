/**
 * Tool Registry tests — register/unregister, search, OpenAI mapping
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTool,
  unregisterTool,
  getTool,
  getAllTools,
  getToolsAsOpenAI,
  listToolCategories,
  searchTools,
  type ToolDefinition,
} from "../../lib/tool-registry";

const makeTool = (name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: "object", properties: {} },
  execute: async () => "ok",
  ...overrides,
});

// Isolate between tests by clearing any registered names we add
const testNames: string[] = [];
function reg(t: ToolDefinition) {
  testNames.push(t.name);
  registerTool(t);
}

beforeEach(() => {
  for (const n of testNames) unregisterTool(n);
  testNames.length = 0;
});

describe("tool-registry: register / unregister / get", () => {
  it("registers a tool retrievable by name", () => {
    reg(makeTool("test_tool_1"));
    expect(getTool("test_tool_1")?.name).toBe("test_tool_1");
  });

  it("unregister removes the tool", () => {
    reg(makeTool("test_tool_2"));
    unregisterTool("test_tool_2");
    expect(getTool("test_tool_2")).toBeUndefined();
  });

  it("re-registering overwrites the definition", () => {
    reg(makeTool("test_tool_3", { description: "v1" }));
    reg(makeTool("test_tool_3", { description: "v2" }));
    expect(getTool("test_tool_3")?.description).toBe("v2");
  });

  it("getAllTools returns every registered tool", () => {
    const before = getAllTools().length;
    reg(makeTool("test_tool_a"));
    reg(makeTool("test_tool_b"));
    expect(getAllTools().length).toBe(before + 2);
  });
});

describe("tool-registry: OpenAI format mapping", () => {
  it("getToolsAsOpenAI returns each tool as a function spec", () => {
    reg(makeTool("test_openai", { description: "for openai", inputSchema: { type: "object", properties: { x: { type: "string" } } } }));
    const specs = getToolsAsOpenAI();
    const mine = specs.find(s => s.function.name === "test_openai");
    expect(mine).toBeDefined();
    expect(mine!.type).toBe("function");
    expect(mine!.function.description).toBe("for openai");
    expect(mine!.function.parameters).toEqual({ type: "object", properties: { x: { type: "string" } } });
  });
});

describe("tool-registry: categories", () => {
  it("listToolCategories returns categories used by registered tools", () => {
    reg(makeTool("test_cat_1", { category: "web" }));
    reg(makeTool("test_cat_2", { category: "task" }));
    const cats = listToolCategories();
    expect(cats).toContain("web");
    expect(cats).toContain("task");
  });

  it("returns unique categories sorted", () => {
    reg(makeTool("test_cat_3", { category: "web" }));
    reg(makeTool("test_cat_4", { category: "web" }));
    const cats = listToolCategories();
    const webCount = cats.filter(c => c === "web").length;
    expect(webCount).toBe(1);
  });
});

describe("tool-registry: searchTools", () => {
  it("exact name match scores highest", () => {
    reg(makeTool("findme_exact", { description: "exact match target" }));
    reg(makeTool("other_thing", { description: "also has findme_exact word in description" }));
    const results = searchTools("findme_exact");
    expect(results[0].name).toBe("findme_exact");
  });

  it("name substring beats description substring", () => {
    reg(makeTool("aggregator_tool", { description: "random" }));
    reg(makeTool("random", { description: "this contains aggregator word" }));
    const results = searchTools("aggregator");
    expect(results[0].name).toBe("aggregator_tool");
  });

  it("filters by category", () => {
    reg(makeTool("web_tool_x", { category: "web", description: "test keyword" }));
    reg(makeTool("task_tool_x", { category: "task", description: "test keyword" }));
    const results = searchTools("test", { category: "web" });
    expect(results.every(r => r.category === "web")).toBe(true);
    expect(results.some(r => r.name === "task_tool_x")).toBe(false);
  });

  it("honors maxResults", () => {
    for (let i = 0; i < 5; i++) reg(makeTool(`test_cap_${i}`, { description: "cap keyword" }));
    const results = searchTools("cap", { maxResults: 3 });
    expect(results.length).toBe(3);
  });

  it("empty query returns no results", () => {
    reg(makeTool("x"));
    expect(searchTools("").length).toBe(0);
  });

  it("non-matching query returns empty", () => {
    reg(makeTool("findable_tool"));
    expect(searchTools("zyxwvu_totally_nope").length).toBe(0);
  });

  it("multi-term queries score by term overlap", () => {
    reg(makeTool("python_debug_tool", { description: "debug python code" }));
    reg(makeTool("python_tool", { description: "python code only" }));
    const results = searchTools("python debug");
    expect(results[0].name).toBe("python_debug_tool");
  });
});
