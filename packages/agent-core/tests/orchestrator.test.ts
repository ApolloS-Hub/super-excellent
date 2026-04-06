import { describe, it, expect } from "vitest";
import { WORKER_ROLES, getWorkerById, getWorkersByExpertise } from "../src/orchestrator/workers.js";

describe("Worker Roles", () => {
  it("exposes the richer canonical 20-role roster", () => {
    expect(WORKER_ROLES).toHaveLength(20);
    expect(WORKER_ROLES.map((worker) => worker.id)).toEqual(
      expect.arrayContaining([
        "developer",
        "reviewer",
        "operations-director",
        "growth-hacker",
        "customer-support",
        "risk-analyst",
      ]),
    );
  });

  it("should find worker by id", () => {
    const dev = getWorkerById("developer");
    expect(dev).toBeDefined();
    expect(dev!.name).toBe("Full-Stack Developer");
    expect(dev!.nameZh).toBe("全栈开发");
    expect(dev!.allowedTools).toContain("Bash");
  });

  it("should find workers by expertise", () => {
    const matches = getWorkersByExpertise(["coding", "debugging"]);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(w => w.id === "developer")).toBe(true);
  });

  it("should match researcher for research queries", () => {
    const matches = getWorkersByExpertise(["research", "analysis"]);
    expect(matches.some(w => w.id === "researcher")).toBe(true);
  });

  it("should match business roles for operational queries", () => {
    const matches = getWorkersByExpertise(["growth", "retention", "ab-testing"]);
    expect(matches.some(w => w.id === "growth-hacker")).toBe(true);
  });

  it("should return empty for irrelevant expertise", () => {
    const matches = getWorkersByExpertise(["xyznonexistent"]);
    expect(matches).toHaveLength(0);
  });
});
