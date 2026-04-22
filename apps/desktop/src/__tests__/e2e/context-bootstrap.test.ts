/**
 * Context Bootstrap tests — cross-session context markdown
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getContextSnapshot,
  updateContext,
  addToContext,
  removeFromContext,
  buildContextPrompt,
  extractContextFromResponse,
} from "../../lib/context-bootstrap";

beforeEach(() => {
  localStorage.clear();
});

describe("context-bootstrap: snapshot CRUD", () => {
  it("getContextSnapshot returns an empty snapshot initially", () => {
    const snap = getContextSnapshot();
    expect(snap.activeProjects).toEqual([]);
    expect(snap.pendingTasks).toEqual([]);
    expect(snap.weeklyFocus).toBe("");
  });

  it("updateContext persists and applies size limits", () => {
    const items = Array.from({ length: 20 }, (_, i) => `project-${i}`);
    updateContext({ activeProjects: items });
    const snap = getContextSnapshot();
    expect(snap.activeProjects.length).toBeLessThanOrEqual(10);
    expect(snap.activeProjects[0]).toBe("project-0");
  });

  it("updateContext preserves fields not in the patch", () => {
    updateContext({ weeklyFocus: "Q4 launch" });
    updateContext({ activeProjects: ["alpha"] });
    const snap = getContextSnapshot();
    expect(snap.weeklyFocus).toBe("Q4 launch");
    expect(snap.activeProjects).toEqual(["alpha"]);
  });

  it("addToContext appends new items to the head", () => {
    addToContext("activeProjects", "first");
    addToContext("activeProjects", "second");
    const snap = getContextSnapshot();
    expect(snap.activeProjects).toEqual(["second", "first"]);
  });

  it("addToContext deduplicates", () => {
    addToContext("activeProjects", "alpha");
    addToContext("activeProjects", "alpha");
    addToContext("activeProjects", "alpha");
    expect(getContextSnapshot().activeProjects).toEqual(["alpha"]);
  });

  it("addToContext caps at 10 items", () => {
    for (let i = 0; i < 15; i++) addToContext("pendingTasks", `task-${i}`);
    expect(getContextSnapshot().pendingTasks.length).toBe(10);
  });

  it("weeklyFocus is set as a string, not a list", () => {
    addToContext("weeklyFocus", "ship the dashboard");
    expect(getContextSnapshot().weeklyFocus).toBe("ship the dashboard");
  });

  it("removeFromContext deletes matching items", () => {
    updateContext({ pendingTasks: ["t1", "t2", "t3"] });
    removeFromContext("pendingTasks", "t2");
    expect(getContextSnapshot().pendingTasks).toEqual(["t1", "t3"]);
  });
});

describe("context-bootstrap: buildContextPrompt", () => {
  it("returns empty string when snapshot is empty", () => {
    expect(buildContextPrompt()).toBe("");
  });

  it("includes all populated sections as markdown headers", () => {
    updateContext({
      weeklyFocus: "Launch Q4",
      activeProjects: ["Project Alpha", "Project Beta"],
      pendingTasks: ["fix bug", "write spec"],
      blockers: ["waiting on design"],
    });
    const prompt = buildContextPrompt();
    expect(prompt).toContain("# Secretary Context");
    expect(prompt).toContain("## Weekly Focus");
    expect(prompt).toContain("Launch Q4");
    expect(prompt).toContain("## Active Projects");
    expect(prompt).toContain("Project Alpha");
    expect(prompt).toContain("## Pending Tasks");
    expect(prompt).toContain("## Blockers");
  });

  it("omits empty sections", () => {
    updateContext({ weeklyFocus: "focused" });
    const prompt = buildContextPrompt();
    expect(prompt).toContain("## Weekly Focus");
    expect(prompt).not.toContain("## Pending Tasks");
  });
});

describe("context-bootstrap: extractContextFromResponse", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("extracts project mentions", () => {
    extractContextFromResponse("I'm working on the payments project this week", "noted");
    expect(getContextSnapshot().activeProjects.length).toBeGreaterThan(0);
  });

  it("extracts deadlines from user message", () => {
    extractContextFromResponse("deadline: ship by end of Q4", "ok");
    expect(getContextSnapshot().upcomingDeadlines.length).toBeGreaterThan(0);
  });

  it("extracts decisions from combined user + assistant content", () => {
    extractContextFromResponse("what should we go with?", "we'll go with option A for now");
    expect(getContextSnapshot().recentDecisions.length).toBeGreaterThan(0);
  });

  it("returns the learned items structured by section", () => {
    const learned = extractContextFromResponse("working on security project", "noted");
    expect(learned.activeProjects).toBeDefined();
    expect(Array.isArray(learned.activeProjects)).toBe(true);
  });

  it("returns empty when nothing matches patterns", () => {
    const learned = extractContextFromResponse("hello", "hi");
    expect(Object.keys(learned).length).toBe(0);
  });
});
