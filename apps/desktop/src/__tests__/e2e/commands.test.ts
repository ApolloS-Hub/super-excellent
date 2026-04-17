/**
 * commands.ts tests — control plane separation
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseSlashCommand,
  dispatchCommand,
  listCommands,
  getCommand,
  registerCommand,
} from "../../lib/commands";
import type { AgentConfig } from "../../lib/agent-bridge";

const makeCtx = (overrides: Partial<Parameters<typeof dispatchCommand>[1]> = {}) => ({
  conversation: null,
  localMessages: [],
  setLocalMessages: vi.fn(),
  config: { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-6" } as AgentConfig,
  ...overrides,
});

describe("parseSlashCommand", () => {
  it("parses simple command", () => {
    expect(parseSlashCommand("/clear")).toEqual({ command: "clear", args: [] });
  });

  it("parses command with args", () => {
    expect(parseSlashCommand("/commit add new feature")).toEqual({
      command: "commit",
      args: ["add", "new", "feature"],
    });
  });

  it("lowercases command name", () => {
    expect(parseSlashCommand("/HELP")).toEqual({ command: "help", args: [] });
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("  hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  it("returns null for empty slash", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(parseSlashCommand("  /clear  ")).toEqual({ command: "clear", args: [] });
  });
});

describe("built-in commands", () => {
  it("/clear empties localMessages", async () => {
    const setLocalMessages = vi.fn();
    const result = await dispatchCommand("/clear", makeCtx({ setLocalMessages }));
    expect(setLocalMessages).toHaveBeenCalledWith([]);
    expect(result).toContain("🗑️");
  });

  it("/compact with few messages returns 'too short'", async () => {
    const result = await dispatchCommand("/compact", makeCtx({
      localMessages: [{ id: "1", role: "user", content: "hi", timestamp: new Date() }],
    }));
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("/cost returns cost hint", async () => {
    const result = await dispatchCommand("/cost", makeCtx());
    expect(result).toContain("💰");
  });

  it("/config shows provider/model/etc", async () => {
    const result = await dispatchCommand("/config", makeCtx({
      config: { provider: "anthropic", apiKey: "sk-test", model: "claude-sonnet-4-6" } as AgentConfig,
    }));
    expect(result).toContain("anthropic");
    expect(result).toContain("claude-sonnet-4-6");
  });

  it("unknown command returns ❓ error", async () => {
    const result = await dispatchCommand("/no_such_command_xyz", makeCtx());
    expect(result).toContain("❓");
  });

  it("non-slash input returns null (not a command)", async () => {
    const result = await dispatchCommand("hello world", makeCtx());
    expect(result).toBeNull();
  });

  it("/help lists all commands", async () => {
    const result = await dispatchCommand("/help", makeCtx());
    expect(result).toContain("/clear");
    expect(result).toContain("/config");
    expect(result).toContain("/cost");
  });

  it("aliases work", async () => {
    const cls = await dispatchCommand("/cls", makeCtx({ setLocalMessages: vi.fn() }));
    expect(cls).toContain("🗑️");
  });
});

describe("registerCommand", () => {
  it("registers a custom command", () => {
    registerCommand({
      name: "testcmd_xyz",
      description: "Test",
      handler: () => "custom result",
    });
    expect(getCommand("testcmd_xyz")).toBeDefined();
    expect(listCommands().some(c => c.name === "testcmd_xyz")).toBe(true);
  });

  it("handler errors are caught and returned as ❌ message", async () => {
    registerCommand({
      name: "errcmd_test",
      description: "Errors",
      handler: () => { throw new Error("boom"); },
    });
    const result = await dispatchCommand("/errcmd_test", makeCtx());
    expect(result).toContain("❌");
    expect(result).toContain("boom");
  });
});
