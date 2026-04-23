/**
 * OpenSpec-inspired commands — /propose, /apply, /archive
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initScenarioEngine,
  matchScenario,
  getScenarioTemplate,
  runScenario,
  getScenarioInstance,
  collectScenarioOutput,
} from "../../lib/scenario-engine";

describe("spec-driven scenario template", () => {
  beforeEach(() => initScenarioEngine());

  it("registers the spec_driven scenario", () => {
    expect(getScenarioTemplate("spec_driven")).toBeDefined();
  });

  it("has 5 steps: proposal → spec → design → tasks → review", () => {
    const tmpl = getScenarioTemplate("spec_driven")!;
    expect(tmpl.steps.map(s => s.id)).toEqual(["proposal", "spec", "design", "tasks", "review"]);
  });

  it("review step is optional", () => {
    const tmpl = getScenarioTemplate("spec_driven")!;
    expect(tmpl.steps.find(s => s.id === "review")!.optional).toBe(true);
  });

  it("matches propose/spec/写需求 keywords", () => {
    expect(matchScenario("我要写需求")?.id).toBe("spec_driven");
    expect(matchScenario("propose a new feature")?.id).toBe("spec_driven");
    expect(matchScenario("写方案吧")?.id).toBe("spec_driven");
    expect(matchScenario("spec for login page")?.id).toBe("spec_driven");
    expect(matchScenario("功能提案：暗色模式")?.id).toBe("spec_driven");
  });

  it("design step depends on proposal + spec", () => {
    const tmpl = getScenarioTemplate("spec_driven")!;
    const design = tmpl.steps.find(s => s.id === "design")!;
    expect(design.inputFrom).toContain("proposal");
    expect(design.inputFrom).toContain("spec");
  });

  it("tasks step depends on design", () => {
    const tmpl = getScenarioTemplate("spec_driven")!;
    const tasks = tmpl.steps.find(s => s.id === "tasks")!;
    expect(tasks.inputFrom).toContain("design");
  });

  it("runs end-to-end and produces all 5 step results", async () => {
    const execute = vi.fn(async (_wid: string, task: string) => {
      if (task.includes("proposal") || task.includes("proposal")) return "# Proposal\n\nProblem: X\nSolution: Y\nScope: Z";
      if (task.includes("specs") || task.includes("scenarios")) return "## Scenario 1\nGiven A, When B, Then C";
      if (task.includes("technical design") || task.includes("design")) return "## Design\n\nComponent changes: ...\nAPI changes: ...";
      if (task.includes("task list") || task.includes("tasks") || task.includes("checklist")) return "- [ ] Task 1 (developer, M)\n- [ ] Task 2 (tester, S)";
      if (task.includes("review") || task.includes("Review")) return "APPROVE — looks good, minor suggestion on error handling";
      return `output for: ${task.slice(0, 30)}`;
    });

    const instance = await runScenario("spec_driven", execute, { idea: "add dark mode" });
    expect(instance.status).toBe("completed");
    expect(Object.keys(instance.stepResults)).toContain("proposal");
    expect(Object.keys(instance.stepResults)).toContain("spec");
    expect(Object.keys(instance.stepResults)).toContain("design");
    expect(Object.keys(instance.stepResults)).toContain("tasks");
    expect(instance.stepResults["proposal"].status).toBe("done");
    expect(instance.stepResults["tasks"].status).toBe("done");
  });

  it("injects user context (idea) into step prompts", async () => {
    let firstPrompt = "";
    const execute = vi.fn(async (_wid: string, task: string) => {
      if (!firstPrompt) firstPrompt = task;
      return "output";
    });
    await runScenario("spec_driven", execute, { idea: "add dark mode" });
    expect(firstPrompt).toContain("add dark mode");
  });

  it("collectScenarioOutput renders structured markdown with all sections", async () => {
    const execute = vi.fn(async () => "step content here");
    const instance = await runScenario("spec_driven", execute, { idea: "x" });
    const output = collectScenarioOutput(instance);
    expect(output).toContain("# 需求规格化");
    expect(output).toContain("## ");
    expect(output).toContain("step content here");
  });

  it("still completes if review step fails (it is optional)", async () => {
    let stepCount = 0;
    const execute = vi.fn(async () => {
      stepCount++;
      if (stepCount === 5) throw new Error("review failed");
      return "output";
    });
    const instance = await runScenario("spec_driven", execute, { idea: "x" });
    expect(instance.status).toBe("completed");
  });
});

describe("openspec localStorage handoff", () => {
  beforeEach(() => {
    localStorage.clear();
    initScenarioEngine();
  });

  it("active instance ID can be stored and retrieved", async () => {
    const execute = vi.fn(async () => "out");
    const instance = await runScenario("spec_driven", execute, { idea: "test" });
    localStorage.setItem("openspec-active-instance", instance.instanceId);
    expect(localStorage.getItem("openspec-active-instance")).toBe(instance.instanceId);
    expect(getScenarioInstance(instance.instanceId)).toBeDefined();
  });

  it("clearing active instance works for /archive flow", async () => {
    localStorage.setItem("openspec-active-instance", "scenario_999");
    localStorage.removeItem("openspec-active-instance");
    expect(localStorage.getItem("openspec-active-instance")).toBeNull();
  });
});
