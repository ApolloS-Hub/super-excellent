/**
 * Artifact Graph tests — change propagation engine
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createArtifact,
  getArtifact,
  getAllArtifacts,
  getStaleArtifacts,
  updateArtifact,
  deleteArtifact,
  addDependency,
  removeDependency,
  getUpstream,
  getDownstream,
  getDependencyGraph,
  onPropagation,
  regenerateStale,
  linkScenarioArtifacts,
  type PropagationEvent,
} from "../../lib/artifact-graph";

// Helper: clear all artifacts between tests by deleting them
function clearAll() {
  for (const a of getAllArtifacts()) deleteArtifact(a.id);
}

describe("artifact-graph: create/read/update/delete", () => {
  beforeEach(clearAll);

  it("createArtifact stores with correct initial state", () => {
    const a = createArtifact("task_1", "task", "Write spec", "initial content", "writer", "step_1");
    expect(a.id).toBe("task_1");
    expect(a.version).toBe(1);
    expect(a.stale).toBe(false);
    expect(a.owner).toBe("writer");
    expect(a.sourceStep).toBe("step_1");
  });

  it("updateArtifact bumps version + clears stale", () => {
    const a = createArtifact("task_2", "task", "x", "v1");
    a.stale = true;
    const updated = updateArtifact("task_2", "v2");
    expect(updated?.version).toBe(2);
    expect(updated?.stale).toBe(false);
    expect(updated?.content).toBe("v2");
  });

  it("deleteArtifact removes the artifact + associated edges", () => {
    createArtifact("a", "task", "A", "c");
    createArtifact("b", "task", "B", "c");
    addDependency("a", "b");
    deleteArtifact("a");
    expect(getArtifact("a")).toBeUndefined();
    expect(getDownstream("b").length).toBe(0);
    expect(getDependencyGraph().edges.length).toBe(0);
  });

  it("getAllArtifacts returns everything", () => {
    createArtifact("x1", "task", "x", "1");
    createArtifact("x2", "plan", "y", "2");
    expect(getAllArtifacts().length).toBe(2);
  });
});

describe("artifact-graph: dependencies", () => {
  beforeEach(clearAll);

  it("addDependency creates an edge", () => {
    createArtifact("p", "plan", "P", "c");
    createArtifact("t", "task", "T", "c");
    addDependency("p", "t");
    expect(getDownstream("p").map(a => a.id)).toEqual(["t"]);
    expect(getUpstream("t").map(a => a.id)).toEqual(["p"]);
  });

  it("addDependency does not duplicate edges", () => {
    createArtifact("p", "plan", "P", "c");
    createArtifact("t", "task", "T", "c");
    addDependency("p", "t");
    addDependency("p", "t");
    expect(getDependencyGraph().edges.length).toBe(1);
  });

  it("removeDependency deletes the edge", () => {
    createArtifact("p", "plan", "P", "c");
    createArtifact("t", "task", "T", "c");
    addDependency("p", "t");
    removeDependency("p", "t");
    expect(getDependencyGraph().edges.length).toBe(0);
  });

  it("supports relation types", () => {
    createArtifact("a", "task", "a", "c");
    createArtifact("b", "task", "b", "c");
    addDependency("a", "b", "blocks");
    const graph = getDependencyGraph();
    expect(graph.edges[0].relation).toBe("blocks");
  });
});

describe("artifact-graph: propagation", () => {
  beforeEach(clearAll);

  it("updating an artifact cascades stale to direct downstream", () => {
    createArtifact("p", "plan", "P", "plan-v1");
    createArtifact("t", "task", "T", "task-v1");
    addDependency("p", "t");
    updateArtifact("p", "plan-v2");
    expect(getArtifact("t")!.stale).toBe(true);
  });

  it("cascades through multi-level chains", () => {
    createArtifact("root", "plan", "R", "v1");
    createArtifact("mid", "task", "M", "v1");
    createArtifact("leaf", "document", "L", "v1");
    addDependency("root", "mid");
    addDependency("mid", "leaf");
    updateArtifact("root", "v2");
    expect(getArtifact("mid")!.stale).toBe(true);
    expect(getArtifact("leaf")!.stale).toBe(true);
  });

  it("onPropagation fires stale events with cascadedFrom", () => {
    const events: PropagationEvent[] = [];
    const unsub = onPropagation(e => events.push(e));
    createArtifact("u", "plan", "U", "v1");
    createArtifact("d", "task", "D", "v1");
    addDependency("u", "d");
    updateArtifact("u", "v2");
    const staleEvents = events.filter(e => e.type === "stale");
    expect(staleEvents.length).toBeGreaterThan(0);
    expect(staleEvents[0].artifactId).toBe("d");
    expect(staleEvents[0].cascadedFrom).toBe("u");
    unsub();
  });

  it("getStaleArtifacts returns only stale ones", () => {
    createArtifact("a", "task", "A", "v1");
    createArtifact("b", "task", "B", "v1");
    addDependency("a", "b");
    updateArtifact("a", "v2");
    const stale = getStaleArtifacts();
    expect(stale.map(s => s.id)).toEqual(["b"]);
  });

  it("does not cascade into non-connected artifacts", () => {
    createArtifact("a", "task", "A", "v1");
    createArtifact("b", "task", "B", "v1");
    createArtifact("c", "task", "C", "v1"); // disconnected
    addDependency("a", "b");
    updateArtifact("a", "v2");
    expect(getArtifact("c")!.stale).toBe(false);
  });
});

describe("artifact-graph: regenerateStale", () => {
  beforeEach(clearAll);

  it("calls regenerate for each stale artifact + clears stale", async () => {
    createArtifact("u", "plan", "U", "upstream content");
    createArtifact("d", "task", "D", "downstream-v1");
    addDependency("u", "d");
    updateArtifact("u", "upstream content v2");
    expect(getArtifact("d")!.stale).toBe(true);

    const regen = vi.fn(async (a, upstream) => `regenerated based on: ${upstream.slice(0, 20)}...`);
    const updated = await regenerateStale(regen);
    expect(updated.map(a => a.id)).toContain("d");
    expect(getArtifact("d")!.stale).toBe(false);
    expect(regen).toHaveBeenCalledTimes(1);
  });

  it("processes in topological order", async () => {
    createArtifact("x", "plan", "X", "vx");
    createArtifact("y", "task", "Y", "vy");
    createArtifact("z", "task", "Z", "vz");
    addDependency("x", "y");
    addDependency("y", "z");
    updateArtifact("x", "vx2"); // makes y + z stale

    const order: string[] = [];
    await regenerateStale(async (a) => {
      order.push(a.id);
      return `regen(${a.id})`;
    });
    expect(order.indexOf("y")).toBeLessThan(order.indexOf("z"));
  });

  it("leaves stale if regenerate throws", async () => {
    createArtifact("a", "plan", "A", "v1");
    createArtifact("b", "task", "B", "v1");
    addDependency("a", "b");
    updateArtifact("a", "v2");
    await regenerateStale(async () => { throw new Error("nope"); });
    expect(getArtifact("b")!.stale).toBe(true);
  });
});

describe("artifact-graph: linkScenarioArtifacts", () => {
  beforeEach(clearAll);

  it("creates a linear dependency chain from scenario step outputs", () => {
    linkScenarioArtifacts("scenario_1", [
      { stepId: "gather", content: "items: a, b, c" },
      { stepId: "prioritize", content: "order: a > c > b" },
      { stepId: "schedule", content: "mon: a, tue: c, wed: b" },
    ]);
    const gather = getArtifact("scenario_1:gather");
    const prioritize = getArtifact("scenario_1:prioritize");
    const schedule = getArtifact("scenario_1:schedule");
    expect(gather).toBeDefined();
    expect(prioritize).toBeDefined();
    expect(schedule).toBeDefined();
    expect(getDownstream("scenario_1:gather").map(a => a.id)).toEqual(["scenario_1:prioritize"]);
    expect(getDownstream("scenario_1:prioritize").map(a => a.id)).toEqual(["scenario_1:schedule"]);
  });
});
