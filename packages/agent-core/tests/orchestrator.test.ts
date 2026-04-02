import { describe, it, expect } from "vitest";
import { WORKER_ROLES, getWorkerById, getWorkersByExpertise } from "../src/orchestrator/workers.js";

describe("Worker Roles", () => {
  it("should have 6 pre-defined roles", () => {
    expect(WORKER_ROLES).toHaveLength(6);
  });

  it("should find worker by id", () => {
    const dev = getWorkerById("developer");
    expect(dev).toBeDefined();
    expect(dev!.name).toBe("Developer");
    expect(dev!.nameZh).toBe("开发工程师");
    expect(dev!.allowedTools).toContain("Bash");
  });

  it("should find workers by expertise", () => {
    const matches = getWorkersByExpertise(["code", "implement"]);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(w => w.id === "developer")).toBe(true);
  });

  it("should match researcher for research queries", () => {
    const matches = getWorkersByExpertise(["research", "analyze"]);
    expect(matches.some(w => w.id === "researcher")).toBe(true);
  });

  it("should return empty for irrelevant expertise", () => {
    const matches = getWorkersByExpertise(["xyznonexistent"]);
    expect(matches).toHaveLength(0);
  });
});
