import { describe, it, expect, beforeEach } from "vitest";
import {
  addRule,
  removeRule,
  toggleRule,
  listRules,
  listActiveRules,
  clearRules,
  buildInstructionPrompt,
  violatesAnyRule,
} from "../../lib/instruction-memory";

describe("Instruction Memory", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i: number) => [...store.keys()][i] ?? null,
      },
      writable: true,
      configurable: true,
    });
    clearRules();
  });

  it("addRule creates a rule with unique id", () => {
    const r1 = addRule("always use TypeScript");
    const r2 = addRule("respond in Chinese");
    expect(r1.id).not.toBe(r2.id);
    expect(r1.rule).toBe("always use TypeScript");
    expect(r1.enabled).toBe(true);
  });

  it("listRules returns all rules including disabled", () => {
    addRule("rule 1");
    addRule("rule 2");
    expect(listRules().length).toBe(2);
  });

  it("listActiveRules excludes disabled", () => {
    const r1 = addRule("rule 1");
    addRule("rule 2");
    toggleRule(r1.id);
    expect(listActiveRules().length).toBe(1);
  });

  it("removeRule deletes by id", () => {
    const r = addRule("temp rule");
    expect(removeRule(r.id)).toBe(true);
    expect(listRules().length).toBe(0);
  });

  it("removeRule returns false for unknown id", () => {
    expect(removeRule("nonexistent")).toBe(false);
  });

  it("buildInstructionPrompt formats active rules", () => {
    addRule("always use TypeScript");
    addRule("never use any/unknown");
    const prompt = buildInstructionPrompt();
    expect(prompt).toContain("User Instructions");
    expect(prompt).toContain("always use TypeScript");
    expect(prompt).toContain("never use any/unknown");
  });

  it("buildInstructionPrompt groups by category", () => {
    addRule("use Chinese", "language");
    addRule("use TypeScript", "code");
    const prompt = buildInstructionPrompt();
    expect(prompt).toContain("### language");
    expect(prompt).toContain("### code");
  });

  it("buildInstructionPrompt returns empty when no rules", () => {
    expect(buildInstructionPrompt()).toBe("");
  });

  it("violatesAnyRule detects forbidden words", () => {
    addRule("Avoid console.log in production");
    const violation = violatesAnyRule("I added console.log in production code");
    expect(violation).not.toBeNull();
    expect(violation?.rule).toContain("console.log");
  });

  it("violatesAnyRule returns null when no violation", () => {
    addRule("Always prefer async/await");
    expect(violatesAnyRule("Looking good!")).toBeNull();
  });
});
