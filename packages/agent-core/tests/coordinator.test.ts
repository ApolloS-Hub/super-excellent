import { describe, it, expect } from "vitest";
import { WorkflowTaskCoordinator } from "../src/orchestrator/coordinator.js";
import { createLearningStore } from "../src/memory/learnings.js";

describe("WorkflowTaskCoordinator", () => {
  it("starts in think phase", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-1", store);
    expect(coord.getCurrentPhase()).toBe("think");
  });

  it("runs gate checks and reports missing requirements", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-2", store);
    const checks = coord.runGateChecks();
    expect(checks.length).toBeGreaterThan(0);
    const goalCheck = checks.find(c => c.check === "goal_defined");
    expect(goalCheck?.passed).toBe(false);
  });

  it("advances after setting required artifacts", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-3", store);
    coord.setArtifact("goal", "Build a chat app");
    const result = coord.tryAdvance();
    expect(result.advanced).toBe(true);
    expect(result.phase).toBe("plan");
  });

  it("creates tasks with role-phase affinity", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-4", store);
    coord.setArtifact("goal", "Test");
    coord.tryAdvance(); // → plan

    const tasks = coord.createPhaseTasks([
      { title: "Write spec", description: "Create technical specification" },
    ]);
    expect(tasks.length).toBe(1);
    expect(tasks[0].assignee).toBeDefined();
    expect(tasks[0].phase).toBe("plan");
  });

  it("tracks progress correctly", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-5", store);
    coord.setArtifact("goal", "Test");
    coord.tryAdvance(); // → plan

    const tasks = coord.createPhaseTasks([
      { title: "Task A", description: "Do A" },
      { title: "Task B", description: "Do B" },
    ]);

    const ready = coord.getReadyTasks();
    expect(ready.length).toBe(2);

    coord.startTask(tasks[0].id);
    coord.completeTask(tasks[0].id);

    const progress = coord.getProgress();
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.percent).toBe(50);
  });

  it("self-heals on task failure", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-6", store, { autoHeal: true });
    coord.setArtifact("goal", "Test");
    coord.tryAdvance(); // → plan

    const tasks = coord.createPhaseTasks([
      { title: "Failing task", description: "This will fail", roleId: "product-manager" },
    ]);

    coord.startTask(tasks[0].id);
    // Fail 3 times to exhaust retries
    coord.failTask(tasks[0].id, "Error 1");
    coord.startTask(tasks[0].id);
    coord.failTask(tasks[0].id, "Error 2");
    coord.startTask(tasks[0].id);
    const result = coord.failTask(tasks[0].id, "Error 3");

    expect(result.canRetry).toBe(false);
    expect(result.healed).toBe(true); // Should have created a replacement task

    // Check that learnings were recorded
    expect(store.learnings.size).toBeGreaterThan(0);
  });

  it("splits tasks into subtasks", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-7", store);
    coord.setArtifact("goal", "Test");
    coord.tryAdvance(); // → plan

    const tasks = coord.createPhaseTasks([
      { title: "Big task", description: "Complex task" },
    ]);

    const subtasks = coord.splitTask(tasks[0].id, [
      { title: "Sub 1", description: "First subtask" },
      { title: "Sub 2", description: "Second subtask" },
      { title: "Sub 3", description: "Third subtask" },
    ]);

    expect(subtasks.length).toBe(3);
    expect(subtasks[1].dependencies).toContain(subtasks[0].id);
    expect(subtasks[2].dependencies).toContain(subtasks[1].id);
  });

  it("recommends roles based on learnings", () => {
    const store = createLearningStore();
    const coord = new WorkflowTaskCoordinator("test-8", store, { learningEnabled: true });

    const role = coord.recommendRole("Write API spec", ["api", "spec"]);
    expect(role).toBeDefined();
    expect(role?.id).toBeDefined();
  });
});
