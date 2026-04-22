/**
 * Scenario Engine tests — framework-first scaffolding
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initScenarioEngine,
  matchScenario,
  getScenarioTemplates,
  getScenarioTemplate,
  registerScenario,
  startScenario,
  getScenarioInstance,
  collectScenarioOutput,
  runScenario,
} from "../../lib/scenario-engine";

describe("scenario-engine: templates", () => {
  beforeEach(() => {
    initScenarioEngine();
  });

  it("registers the 5 built-in scenarios", () => {
    const templates = getScenarioTemplates();
    const ids = templates.map(t => t.id);
    expect(ids).toContain("weekly_planning");
    expect(ids).toContain("meeting_prep");
    expect(ids).toContain("email_triage");
    expect(ids).toContain("daily_standup");
    expect(ids).toContain("doc_review");
  });

  it("each built-in scenario has steps with worker assignments", () => {
    for (const t of getScenarioTemplates()) {
      expect(t.steps.length).toBeGreaterThan(0);
      expect(t.triggerKeywords.length).toBeGreaterThan(0);
      for (const step of t.steps) {
        expect(step.id).toBeTruthy();
        expect(step.action).toBeTruthy();
      }
    }
  });

  it("getScenarioTemplate returns exact match by id", () => {
    const tmpl = getScenarioTemplate("weekly_planning");
    expect(tmpl).toBeDefined();
    expect(tmpl!.name).toBe("周计划制定");
  });

  it("registerScenario adds custom templates", () => {
    registerScenario({
      id: "custom_ritual",
      name: "custom",
      nameEn: "Custom",
      description: "x",
      triggerKeywords: ["customkw"],
      steps: [{ id: "s1", label: "s1", labelEn: "s1", action: "do step 1" }],
    });
    expect(getScenarioTemplate("custom_ritual")).toBeDefined();
  });
});

describe("scenario-engine: matchScenario", () => {
  beforeEach(() => {
    initScenarioEngine();
  });

  it("matches weekly planning keywords (中英双语)", () => {
    expect(matchScenario("帮我规划本周工作")?.id).toBe("weekly_planning");
    expect(matchScenario("plan this week for me")?.id).toBe("weekly_planning");
    expect(matchScenario("I want to plan my week")?.id).toBe("weekly_planning");
  });

  it("matches meeting prep keywords", () => {
    expect(matchScenario("准备会议")?.id).toBe("meeting_prep");
    expect(matchScenario("help me prepare meeting")?.id).toBe("meeting_prep");
  });

  it("matches email triage keywords", () => {
    expect(matchScenario("处理邮件")?.id).toBe("email_triage");
    expect(matchScenario("triage email please")?.id).toBe("email_triage");
  });

  it("matches daily standup keywords", () => {
    expect(matchScenario("写个日报")?.id).toBe("daily_standup");
    expect(matchScenario("daily standup")?.id).toBe("daily_standup");
  });

  it("returns null for unrelated input", () => {
    expect(matchScenario("what is the weather today")).toBeNull();
    expect(matchScenario("hello")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(matchScenario("PLAN THIS WEEK")?.id).toBe("weekly_planning");
    expect(matchScenario("Email Triage now")?.id).toBe("email_triage");
  });
});

describe("scenario-engine: startScenario + execution", () => {
  beforeEach(() => {
    initScenarioEngine();
  });

  it("creates an instance in running state", () => {
    const inst = startScenario("weekly_planning");
    expect(inst.instanceId).toMatch(/^scenario_\d+$/);
    expect(inst.status).toBe("running");
    expect(inst.currentStepIndex).toBe(0);
    expect(getScenarioInstance(inst.instanceId)).toBeDefined();
  });

  it("captures user context on start", () => {
    const inst = startScenario("weekly_planning", { mood: "tired", focus: "Q4" });
    expect(inst.context).toEqual({ mood: "tired", focus: "Q4" });
  });

  it("throws on unknown template id", () => {
    expect(() => startScenario("nonexistent")).toThrow();
  });

  it("runScenario executes all steps and marks completed", async () => {
    const executeWorker = vi.fn(async (_wid: string, task: string) => `result for: ${task.slice(0, 30)}`);
    const inst = await runScenario("daily_standup", executeWorker);
    expect(inst.status).toBe("completed");
    expect(Object.keys(inst.stepResults).length).toBe(getScenarioTemplate("daily_standup")!.steps.length);
    expect(executeWorker).toHaveBeenCalled();
  });

  it("runScenario passes upstream outputs to dependent steps", async () => {
    registerScenario({
      id: "chain_test",
      name: "chain",
      nameEn: "Chain",
      description: "x",
      triggerKeywords: ["chaintest"],
      steps: [
        { id: "a", label: "a", labelEn: "a", action: "produce A" },
        { id: "b", label: "b", labelEn: "b", action: "produce B using A", inputFrom: ["a"] },
      ],
    });
    let capturedPrompt = "";
    const executeWorker = vi.fn(async (_wid: string, task: string) => {
      if (task.includes("produce B")) capturedPrompt = task;
      return "output for step";
    });
    await runScenario("chain_test", executeWorker);
    expect(capturedPrompt).toContain("Previous step outputs");
    expect(capturedPrompt).toContain("[a]:");
  });

  it("runScenario marks failed when a required step errors", async () => {
    registerScenario({
      id: "fail_test",
      name: "fail",
      nameEn: "Fail",
      description: "x",
      triggerKeywords: ["failtest"],
      steps: [
        { id: "a", label: "a", labelEn: "a", action: "do a" },
        { id: "b", label: "b", labelEn: "b", action: "do b" },
      ],
    });
    const executeWorker = vi.fn(async (_wid: string, _task: string) => {
      throw new Error("simulated failure");
    });
    const inst = await runScenario("fail_test", executeWorker);
    expect(inst.status).toBe("failed");
  });

  it("optional steps failing do not fail the whole scenario", async () => {
    registerScenario({
      id: "optional_fail_test",
      name: "opt",
      nameEn: "opt",
      description: "x",
      triggerKeywords: ["optfail"],
      steps: [
        { id: "a", label: "a", labelEn: "a", action: "do a" },
        { id: "b", label: "b", labelEn: "b", action: "do b", optional: true },
      ],
    });
    let count = 0;
    const executeWorker = vi.fn(async () => {
      count++;
      if (count === 2) throw new Error("b failed");
      return "ok";
    });
    const inst = await runScenario("optional_fail_test", executeWorker);
    expect(inst.status).toBe("completed");
  });
});

describe("scenario-engine: collectScenarioOutput", () => {
  beforeEach(() => initScenarioEngine());

  it("renders scenario output as structured markdown", async () => {
    const executeWorker = vi.fn(async () => "step output text");
    const inst = await runScenario("daily_standup", executeWorker);
    const output = collectScenarioOutput(inst);
    expect(output).toContain("# 每日站会");
    expect(output).toContain("## ");
    expect(output).toContain("step output text");
  });
});
