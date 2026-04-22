/**
 * Quality Gate tests — worker output self-critique
 */
import { describe, it, expect, vi } from "vitest";
import {
  runQualityGate,
  buildRetryPrompt,
  gatedExecute,
  getAvailableChecks,
  getAllRoleChecks,
} from "../../lib/quality-gate";

const ctx = (workerId = "writer", task = "please produce a helpful answer", userMsg = "please produce a helpful answer") => ({
  workerId,
  taskDescription: task,
  userMessage: userMsg,
});

describe("quality-gate: universal checks", () => {
  it("fails when output is empty or trivially short", () => {
    const result = runQualityGate("", ctx());
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some(f => f.checkId === "not_empty")).toBe(true);
  });

  it("passes when output is substantive", () => {
    const result = runQualityGate(
      "A detailed and helpful answer covering all the points you raised.",
      ctx("writer", "produce a helpful answer", "produce a helpful answer"),
    );
    expect(result.failedChecks.some(f => f.checkId === "not_empty")).toBe(false);
  });

  it("catches refusal language", () => {
    const result = runQualityGate("I cannot help with that. As an AI language model...", ctx());
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some(f => f.checkId === "no_refusal_leak")).toBe(true);
  });

  it("catches hallucinated example.com URLs", () => {
    const result = runQualityGate(
      "Check this reference: https://example.com/placeholder-article for more. Additional content here to satisfy minimum length requirements.",
      ctx(),
    );
    expect(result.failedChecks.some(f => f.checkId === "no_hallucinated_urls")).toBe(true);
  });

  it("passes for legitimate URLs", () => {
    const result = runQualityGate(
      "For more info, see https://github.com/actual-org/actual-repo which has relevant docs. Additional detailed content here to satisfy length requirements.",
      ctx(),
    );
    expect(result.failedChecks.some(f => f.checkId === "no_hallucinated_urls")).toBe(false);
  });

  it("flags output that doesn't address key user terms", () => {
    const result = runQualityGate(
      "completely unrelated response about cooking recipes and vegetables garden",
      ctx("writer", "docker kubernetes helm chart deployment", "docker kubernetes helm chart deployment"),
    );
    expect(result.failedChecks.some(f => f.checkId === "answers_the_question")).toBe(true);
  });

  it("score is a fraction between 0 and 1", () => {
    const result = runQualityGate("short", ctx());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("quality-gate: role-specific checks", () => {
  it("developer task requiring code but no code block fails", () => {
    // Output deliberately avoids any code-shape tokens: no `function`, `const`, `class`, no backticks, no 4-space indent
    const result = runQualityGate(
      "Overall, your approach should address the sorting step by step. Think through the ordering of operations and double-check the edge cases before committing.",
      ctx("developer", "implement the sorting algorithm", "implement this"),
    );
    expect(result.failedChecks.some(f => f.checkId === "code_block_present")).toBe(true);
  });

  it("developer output with code block passes", () => {
    const result = runQualityGate(
      "Here's the implementation:\n```ts\nfunction sort(a: number[]) { return a.sort(); }\n```\nReplace your old sort with this.",
      ctx("developer", "implement sort function", "implement sort"),
    );
    expect(result.failedChecks.some(f => f.checkId === "code_block_present")).toBe(false);
  });

  it("writer output with long unstructured content fails", () => {
    const longUnstructured = "a".repeat(50) + " and more prose about writing. ".repeat(20);
    const result = runQualityGate(
      longUnstructured,
      ctx("writer", "long article writing task", "write a long article please"),
    );
    expect(result.failedChecks.some(f => f.checkId === "structured_output")).toBe(true);
  });

  it("writer output with headers/bullets passes structure check", () => {
    const structured = "# Overview\n\n- Point one about the topic\n- Point two about the topic\n\n## Details\n\nMore detailed prose.\n".repeat(3);
    const result = runQualityGate(
      structured,
      ctx("writer", "write documentation please", "write documentation please"),
    );
    expect(result.failedChecks.some(f => f.checkId === "structured_output")).toBe(false);
  });

  it("code_reviewer output lacking specific references fails", () => {
    const result = runQualityGate(
      "The code has some issues. There are bugs somewhere. Please improve it. This needs more work.",
      ctx("code_reviewer", "please review", "review"),
    );
    expect(result.failedChecks.some(f => f.checkId === "specific_feedback")).toBe(true);
  });

  it("code_reviewer output with file/line refs passes", () => {
    const result = runQualityGate(
      "In `src/utils.ts` line 42, the `parseInput` function has a null deref. Consider guarding the input.",
      ctx("code_reviewer", "review the util code", "review code"),
    );
    expect(result.failedChecks.some(f => f.checkId === "specific_feedback")).toBe(false);
  });

  it("PM output without actions fails", () => {
    const result = runQualityGate(
      "Here is the general state of things. Things are happening. People are involved. Lots of important topics.",
      ctx("project_manager", "plan the project", "plan"),
    );
    expect(result.failedChecks.some(f => f.checkId === "actionable_items")).toBe(true);
  });

  it("PM output with TODO/action markers passes", () => {
    const result = runQualityGate(
      "Here's the plan:\n1. Ship auth by Friday\n2. Review PRD on Monday\n\nTODO: schedule kickoff meeting",
      ctx("project_manager", "plan the project", "plan"),
    );
    expect(result.failedChecks.some(f => f.checkId === "actionable_items")).toBe(false);
  });
});

describe("quality-gate: buildRetryPrompt", () => {
  it("includes all failed checks with reasons", () => {
    const gateResult = runQualityGate("", ctx());
    const retry = buildRetryPrompt("original task", "original output", gateResult);
    expect(retry).toContain("Issues Found");
    expect(retry).toContain("Original Task");
    expect(retry).toContain("original task");
    expect(retry).toContain("not_empty");
  });

  it("truncates long previous output for brevity", () => {
    const gateResult = runQualityGate("", ctx());
    const longOut = "x".repeat(2000);
    const retry = buildRetryPrompt("task", longOut, gateResult);
    expect(retry.length).toBeLessThan(longOut.length);
    expect(retry).toContain("…");
  });
});

describe("quality-gate: gatedExecute", () => {
  it("returns output without retry when gate passes", async () => {
    const execute = vi.fn(async () => "A solid and thoroughly helpful response addressing your request about docker deployment patterns.");
    const result = await gatedExecute(
      execute,
      "docker deployment patterns question",
      ctx("writer", "docker deployment patterns", "docker deployment patterns"),
      1,
    );
    expect(result.retried).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries with feedback when gate fails", async () => {
    let calls = 0;
    const execute = vi.fn(async () => {
      calls++;
      return calls === 1
        ? "short"
        : "A thorough answer about docker and kubernetes deployment with enough substance to pass the length checks.";
    });
    const result = await gatedExecute(
      execute,
      "docker deployment",
      ctx("writer", "docker deployment", "docker deployment"),
      1,
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.retried).toBe(true);
  });

  it("stops retrying after maxRetries", async () => {
    const execute = vi.fn(async () => "bad");
    await gatedExecute(execute, "some task", ctx(), 2);
    expect(execute.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe("quality-gate: introspection", () => {
  it("getAvailableChecks lists universal + role-specific", () => {
    const writerChecks = getAvailableChecks("writer");
    const devChecks = getAvailableChecks("developer");
    expect(writerChecks.length).toBeGreaterThan(0);
    expect(devChecks.length).toBeGreaterThan(0);
    expect(writerChecks.some(s => s.startsWith("not_empty"))).toBe(true);
  });

  it("getAllRoleChecks returns all role-specific check IDs", () => {
    const all = getAllRoleChecks();
    expect(all.developer).toBeDefined();
    expect(all.writer).toBeDefined();
    expect(all.code_reviewer).toBeDefined();
    expect(all.project_manager).toBeDefined();
    expect(all.researcher).toBeDefined();
  });
});
