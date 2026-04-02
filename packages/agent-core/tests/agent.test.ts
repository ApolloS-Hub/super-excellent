import { describe, it, expect } from "vitest";
import { createAgent } from "../src/engine/agent.js";
import { createToolExecutor, BUILTIN_TOOLS } from "../src/tools/index.js";

describe("createAgent", () => {
  it("should create an agent instance with all methods", () => {
    const agent = createAgent();
    expect(agent).toBeDefined();
    expect(agent.prompt).toBeTypeOf("function");
    expect(agent.query).toBeTypeOf("function");
    expect(agent.getMessages).toBeTypeOf("function");
    expect(agent.clear).toBeTypeOf("function");
    expect(agent.interrupt).toBeTypeOf("function");
    expect(agent.setModel).toBeTypeOf("function");
    expect(agent.close).toBeTypeOf("function");
  });

  it("should handle prompt without API key (placeholder mode)", async () => {
    const agent = createAgent({ provider: "anthropic" });
    const result = await agent.prompt("Hello");
    expect(result.text).toContain("No API key configured");
    expect(agent.getMessages()).toHaveLength(2);
  });

  it("should clear messages", async () => {
    const agent = createAgent();
    await agent.prompt("Test");
    expect(agent.getMessages()).toHaveLength(2);
    agent.clear();
    expect(agent.getMessages()).toHaveLength(0);
  });

  it("should stream events without API key", async () => {
    const agent = createAgent();
    const events = [];
    for await (const event of agent.query("Stream test")) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe("text");
    expect(events[events.length - 1].type).toBe("result");
  });
});

describe("createToolExecutor", () => {
  it("should create executor with built-in tools", () => {
    const executor = createToolExecutor();
    const defs = executor.getDefinitions();
    expect(defs.length).toBe(BUILTIN_TOOLS.length);
    expect(defs.map(d => d.name)).toContain("Bash");
    expect(defs.map(d => d.name)).toContain("Read");
    expect(defs.map(d => d.name)).toContain("Write");
    expect(defs.map(d => d.name)).toContain("Edit");
    expect(defs.map(d => d.name)).toContain("Glob");
    expect(defs.map(d => d.name)).toContain("Grep");
  });

  it("should execute Bash tool", async () => {
    const executor = createToolExecutor();
    const result = await executor.execute("Bash", { command: "echo hello" });
    expect(result.trim()).toBe("hello");
  });

  it("should return error for unknown tool", async () => {
    const executor = createToolExecutor();
    const result = await executor.execute("NonExistent", {});
    expect(result).toContain("Unknown tool");
  });
});
