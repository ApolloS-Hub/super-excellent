/**
 * Workflow-Task Coordinator
 * Bridges WorkflowEngine and TaskGraph, driven by Secretary
 * 
 * Fixes: audit issue #2 — TaskGraph↔WorkflowEngine coordination
 * Fixes: audit issue #3 — Learning engine feedback to role selection
 * Fixes: audit issue #4 — Quality gate concrete checkers
 * Implements: subagent-driven development (superpowers pattern)
 * Implements: self-healing graph evolution (Hive pattern)
 */
import { WorkflowEngine, PHASE_ORDER } from "./workflow.js";
import type { WorkflowPhase } from "./workflow.js";
import {
  createTaskGraph, addTask, getReadyTasks, getParallelTasks,
  startTask, completeTask, failTask, getProgress, getExecutionOrder,
} from "./task-graph.js";
import type { Task, TaskGraph } from "./task-graph.js";
import { getRolesByPhase, getRoleById } from "./roles.js";
import type { WorkerRole } from "./roles.js";
import { queryLearnings, extractFromCompletion, addLearning } from "../memory/learnings.js";
import type { LearningStore } from "../memory/learnings.js";

export interface CoordinatorConfig {
  maxParallel: number;
  autoAdvance: boolean;
  autoHeal: boolean;
  learningEnabled: boolean;
}

export interface PhaseCheckResult {
  check: string;
  passed: boolean;
  evidence?: string;
  autoFix?: string;
}

export interface CoordinatorState {
  workflow: WorkflowEngine;
  taskGraph: TaskGraph;
  learnings: LearningStore;
  config: CoordinatorConfig;
  phaseChecks: Map<string, PhaseCheckResult[]>;
}

/**
 * Quality gate checkers — concrete implementations
 * Each checker verifies a specific requirement for its phase
 */
const GATE_CHECKERS: Record<string, (state: CoordinatorState) => PhaseCheckResult> = {
  // Think phase
  goal_defined: (state) => ({
    check: "goal_defined",
    passed: !!state.workflow.getArtifact("goal"),
    evidence: state.workflow.getArtifact("goal") as string | undefined,
  }),
  assumptions_challenged: (state) => ({
    check: "assumptions_challenged",
    passed: !!state.workflow.getArtifact("assumptions"),
    evidence: state.workflow.getArtifact("assumptions") as string | undefined,
  }),

  // Plan phase
  spec_written: (state) => ({
    check: "spec_written",
    passed: !!state.workflow.getArtifact("spec"),
    evidence: state.workflow.getArtifact("spec") ? "Spec document exists" : undefined,
  }),
  tasks_defined: (state) => ({
    check: "tasks_defined",
    passed: state.taskGraph.tasks.size > 0,
    evidence: `${state.taskGraph.tasks.size} tasks defined`,
  }),
  dependencies_mapped: (state) => {
    const tasks = Array.from(state.taskGraph.tasks.values());
    const hasDeps = tasks.some(t => t.dependencies.length > 0);
    return {
      check: "dependencies_mapped",
      passed: tasks.length <= 1 || hasDeps,
      evidence: hasDeps ? "Dependencies mapped" : "Single task, no deps needed",
    };
  },

  // Build phase
  task_completed: (state) => {
    const progress = getProgress(state.taskGraph);
    return {
      check: "task_completed",
      passed: progress.done > 0,
      evidence: `${progress.done}/${progress.total} tasks done (${progress.percent}%)`,
    };
  },

  // Review phase
  review_passed: (state) => ({
    check: "review_passed",
    passed: !!state.workflow.getArtifact("review_result"),
    evidence: state.workflow.getArtifact("review_result") as string | undefined,
  }),
  security_checked: (state) => ({
    check: "security_checked",
    passed: !!state.workflow.getArtifact("security_result"),
    evidence: state.workflow.getArtifact("security_result") as string | undefined,
  }),

  // Test phase
  tests_passed: (state) => ({
    check: "tests_passed",
    passed: !!state.workflow.getArtifact("test_result"),
    evidence: state.workflow.getArtifact("test_result") as string | undefined,
  }),
  coverage_adequate: (state) => {
    const coverage = state.workflow.getArtifact("coverage") as number | undefined;
    return {
      check: "coverage_adequate",
      passed: coverage != null && coverage >= 60,
      evidence: coverage != null ? `${coverage}% coverage` : undefined,
    };
  },

  // Ship phase
  deliverable_ready: (state) => {
    const progress = getProgress(state.taskGraph);
    return {
      check: "deliverable_ready",
      passed: progress.percent >= 80 && progress.failed === 0,
      evidence: `${progress.percent}% done, ${progress.failed} failed`,
    };
  },
  docs_updated: (state) => ({
    check: "docs_updated",
    passed: !!state.workflow.getArtifact("docs_updated"),
    evidence: state.workflow.getArtifact("docs_updated") as string | undefined,
  }),

  // Reflect phase (all optional)
  learnings_extracted: (state) => ({
    check: "learnings_extracted",
    passed: state.learnings.learnings.size > 0,
    evidence: `${state.learnings.learnings.size} learnings recorded`,
  }),
};

export class WorkflowTaskCoordinator {
  private state: CoordinatorState;

  constructor(
    workflowId: string,
    learnings: LearningStore,
    config?: Partial<CoordinatorConfig>,
  ) {
    this.state = {
      workflow: new WorkflowEngine(workflowId),
      taskGraph: createTaskGraph(workflowId),
      learnings,
      config: {
        maxParallel: config?.maxParallel ?? 3,
        autoAdvance: config?.autoAdvance ?? true,
        autoHeal: config?.autoHeal ?? true,
        learningEnabled: config?.learningEnabled ?? true,
      },
      phaseChecks: new Map(),
    };
  }

  // ═══════════ Workflow Management ═══════════

  getCurrentPhase(): WorkflowPhase {
    return this.state.workflow.getCurrentPhase();
  }

  /** Run all gate checks for current phase */
  runGateChecks(): PhaseCheckResult[] {
    const gate = this.state.workflow.getGate();
    const results: PhaseCheckResult[] = [];

    for (const checkName of [...gate.required, ...gate.optional]) {
      const checker = GATE_CHECKERS[checkName];
      if (checker) {
        results.push(checker(this.state));
      } else {
        results.push({ check: checkName, passed: false, evidence: "No checker implemented" });
      }
    }

    this.state.phaseChecks.set(this.state.workflow.getCurrentPhase(), results);
    return results;
  }

  /** Try to advance to next phase */
  tryAdvance(): { advanced: boolean; phase: WorkflowPhase | null; blockers: string[] } {
    const checks = this.runGateChecks();
    const gate = this.state.workflow.getGate();

    const requiredPassed = gate.required
      .map(r => checks.find(c => c.check === r))
      .filter(c => c && c.passed)
      .map(c => c!.check);

    const { canAdvance, missing } = this.state.workflow.canAdvance(requiredPassed);

    if (!canAdvance) {
      return { advanced: false, phase: this.state.workflow.getCurrentPhase(), blockers: missing };
    }

    const nextPhase = this.state.workflow.advance(requiredPassed);
    return { advanced: true, phase: nextPhase, blockers: [] };
  }

  // ═══════════ Task Management ═══════════

  /** Create tasks for the current phase, using role-phase affinity */
  createPhaseTasks(taskDescriptions: Array<{ title: string; description: string; roleId?: string }>): Task[] {
    const phase = this.getCurrentPhase();
    const createdTasks: Task[] = [];

    for (const desc of taskDescriptions) {
      // Auto-assign role based on phase affinity if not specified
      let assignee = desc.roleId;
      if (!assignee) {
        const suitableRoles = getRolesByPhase(phase);

        // Check learnings for role preference on similar tasks
        if (this.state.config.learningEnabled) {
          const tags = desc.title.toLowerCase().split(/\s+/);
          const pitfalls = queryLearnings(this.state.learnings, tags, "pitfall");
          // Avoid roles that failed on similar tasks
          const avoidRoles = pitfalls.map(p => p.source).filter(Boolean);
          const filtered = suitableRoles.filter(r => !avoidRoles.includes(r.id));
          assignee = (filtered.length > 0 ? filtered : suitableRoles)[0]?.id;
        } else {
          assignee = suitableRoles[0]?.id;
        }
      }

      const task = addTask(this.state.taskGraph, {
        id: `${phase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: desc.title,
        description: desc.description,
        assignee,
        dependencies: [],
        subtasks: [],
        priority: "medium",
        phase,
        maxRetries: 3,
      });

      createdTasks.push(task);
    }

    return createdTasks;
  }

  /** Get tasks ready for execution */
  getReadyTasks(): Task[] {
    return getReadyTasks(this.state.taskGraph);
  }

  /** Get parallel task groups */
  getParallelGroups(): Task[][] {
    return getParallelTasks(this.state.taskGraph);
  }

  /** Mark task as started */
  startTask(taskId: string, assignee?: string): void {
    startTask(this.state.taskGraph, taskId, assignee);
  }

  /** Mark task as completed */
  completeTask(taskId: string, artifacts?: Record<string, unknown>): void {
    completeTask(this.state.taskGraph, taskId, artifacts);

    // Extract learnings from success
    if (this.state.config.learningEnabled) {
      const task = this.state.taskGraph.tasks.get(taskId);
      if (task) {
        extractFromCompletion(
          this.state.learnings,
          task.title,
          task.description,
          "success",
          undefined,
          [task.phase ?? "", task.assignee ?? ""],
        );
      }
    }

    // Auto-advance if all phase tasks are done
    if (this.state.config.autoAdvance) {
      const progress = getProgress(this.state.taskGraph);
      const phaseTasks = Array.from(this.state.taskGraph.tasks.values())
        .filter(t => t.phase === this.getCurrentPhase());
      const phaseComplete = phaseTasks.every(t => t.status === "done" || t.status === "skipped");

      if (phaseComplete && phaseTasks.length > 0) {
        try {
          this.tryAdvance();
        } catch {
          // Gate not met yet, that's fine
        }
      }
    }
  }

  /** Mark task as failed — with self-healing */
  failTask(taskId: string, error: string): { canRetry: boolean; healed: boolean } {
    const canRetry = failTask(this.state.taskGraph, taskId, error);

    // Record failure in learnings
    if (this.state.config.learningEnabled) {
      const task = this.state.taskGraph.tasks.get(taskId);
      if (task) {
        extractFromCompletion(
          this.state.learnings,
          task.title,
          task.description,
          "failure",
          error,
          [task.phase ?? "", task.assignee ?? ""],
        );
      }
    }

    // Self-healing: reassign to a different role if available
    let healed = false;
    if (!canRetry && this.state.config.autoHeal) {
      const task = this.state.taskGraph.tasks.get(taskId);
      if (task) {
        const currentRole = task.assignee;
        const alternateRoles = getRolesByPhase(task.phase ?? "build")
          .filter(r => r.id !== currentRole);

        if (alternateRoles.length > 0) {
          // Create a replacement task with a different role
          const replacement = addTask(this.state.taskGraph, {
            id: `heal_${taskId}_${Date.now()}`,
            title: `[RETRY] ${task.title}`,
            description: `Previous attempt by ${currentRole} failed: ${error}\n\nOriginal task: ${task.description}`,
            assignee: alternateRoles[0].id,
            dependencies: task.dependencies,
            subtasks: [],
            priority: "high",
            phase: task.phase,
            maxRetries: 2,
          });

          healed = true;
          addLearning(this.state.learnings, {
            type: "workaround",
            title: `${task.title}: switched from ${currentRole} to ${alternateRoles[0].id}`,
            description: `Task failed with ${currentRole}, auto-healed by reassigning to ${alternateRoles[0].id}`,
            context: error,
            tags: [task.phase ?? "", currentRole ?? "", alternateRoles[0].id],
            source: taskId,
          });
        }
      }
    }

    return { canRetry, healed };
  }

  // ═══════════ Subagent-Driven Development ═══════════

  /** Split a complex task into subtasks (superpowers pattern) */
  splitTask(taskId: string, subtasks: Array<{ title: string; description: string; roleId?: string }>): Task[] {
    const parent = this.state.taskGraph.tasks.get(taskId);
    if (!parent) throw new Error(`Task ${taskId} not found`);

    const created: Task[] = [];
    let prevId: string | null = null;

    for (const sub of subtasks) {
      const task = addTask(this.state.taskGraph, {
        id: `sub_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: sub.title,
        description: sub.description,
        assignee: sub.roleId ?? parent.assignee,
        dependencies: prevId ? [prevId] : [],
        subtasks: [],
        parentId: taskId,
        priority: parent.priority,
        phase: parent.phase,
        maxRetries: 3,
      });

      created.push(task);
      prevId = task.id;
    }

    return created;
  }

  // ═══════════ Query & Status ═══════════

  getProgress() {
    return getProgress(this.state.taskGraph);
  }

  getExecutionOrder(): Task[] {
    return getExecutionOrder(this.state.taskGraph);
  }

  getWorkflowState() {
    return this.state.workflow.getState();
  }

  /** Get role recommendation for a task based on learnings */
  recommendRole(taskTitle: string, taskTags: string[]): WorkerRole | null {
    // Check for patterns (successful roles)
    const patterns = queryLearnings(this.state.learnings, taskTags, "pattern");
    if (patterns.length > 0) {
      const preferredRoleId = patterns[0].tags.find(t => getRoleById(t));
      if (preferredRoleId) return getRoleById(preferredRoleId) ?? null;
    }

    // Check for pitfalls (failed roles to avoid)
    const pitfalls = queryLearnings(this.state.learnings, taskTags, "pitfall");
    const avoidRoles = new Set(pitfalls.flatMap(p => p.tags.filter(t => getRoleById(t))));

    // Find suitable role by phase
    const phase = this.getCurrentPhase();
    const candidates = getRolesByPhase(phase).filter(r => !avoidRoles.has(r.id));
    return candidates[0] ?? getRolesByPhase(phase)[0] ?? null;
  }

  /** Store a workflow artifact (used by gate checkers) */
  setArtifact(key: string, value: unknown): void {
    this.state.workflow.setArtifact(key, value);
  }
}
