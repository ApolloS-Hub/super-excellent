/**
 * 7-Phase Workflow Pipeline
 * Inspired by gstack/superpowers: Think → Plan → Build → Review → Test → Ship → Reflect
 * Each phase has entry/exit gates, verification requirements, and auto-repair triggers
 */

export type WorkflowPhase =
  | "think"    // Brainstorm, clarify requirements, challenge assumptions
  | "plan"     // Architecture, task breakdown, dependency graph
  | "build"    // Execute tasks, write code/content
  | "review"   // Code review, quality checks, security audit
  | "test"     // Verification, testing, validation
  | "ship"     // Deliver, deploy, present results
  | "reflect"; // Retrospective, extract learnings, update knowledge

export interface PhaseGate {
  phase: WorkflowPhase;
  required: string[];
  optional: string[];
  autoRepairOn: string[];
}

export interface WorkflowState {
  id: string;
  currentPhase: WorkflowPhase;
  phaseHistory: Array<{ phase: WorkflowPhase; enteredAt: number; exitedAt?: number; result: "pass" | "fail" | "skip" }>;
  artifacts: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

const PHASE_ORDER: WorkflowPhase[] = ["think", "plan", "build", "review", "test", "ship", "reflect"];

const PHASE_GATES: Record<WorkflowPhase, PhaseGate> = {
  think: {
    phase: "think",
    required: ["goal_defined"],
    optional: ["assumptions_challenged", "alternatives_explored"],
    autoRepairOn: [],
  },
  plan: {
    phase: "plan",
    required: ["spec_written", "tasks_defined"],
    optional: ["dependencies_mapped", "risks_identified", "effort_estimated"],
    autoRepairOn: ["spec_incomplete"],
  },
  build: {
    phase: "build",
    required: ["task_completed"],
    optional: ["tests_written_first"],
    autoRepairOn: ["build_error", "type_error"],
  },
  review: {
    phase: "review",
    required: ["review_passed"],
    optional: ["security_checked", "performance_checked"],
    autoRepairOn: ["review_issues_found"],
  },
  test: {
    phase: "test",
    required: ["tests_passed"],
    optional: ["coverage_adequate", "e2e_verified"],
    autoRepairOn: ["test_failure"],
  },
  ship: {
    phase: "ship",
    required: ["deliverable_ready"],
    optional: ["docs_updated", "changelog_written"],
    autoRepairOn: ["deploy_failure"],
  },
  reflect: {
    phase: "reflect",
    required: [],
    optional: ["learnings_extracted", "patterns_saved", "metrics_recorded"],
    autoRepairOn: [],
  },
};

export class WorkflowEngine {
  private state: WorkflowState;

  constructor(id: string, maxRetries = 3) {
    this.state = {
      id,
      currentPhase: "think",
      phaseHistory: [],
      artifacts: {},
      retryCount: 0,
      maxRetries,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  getCurrentPhase(): WorkflowPhase {
    return this.state.currentPhase;
  }

  getGate(): PhaseGate {
    return PHASE_GATES[this.state.currentPhase];
  }

  /** Check if current phase requirements are met */
  canAdvance(completedChecks: string[]): { canAdvance: boolean; missing: string[] } {
    const gate = PHASE_GATES[this.state.currentPhase];
    const missing = gate.required.filter(r => !completedChecks.includes(r));
    return { canAdvance: missing.length === 0, missing };
  }

  /** Advance to next phase */
  advance(completedChecks: string[]): WorkflowPhase | null {
    const { canAdvance, missing } = this.canAdvance(completedChecks);
    if (!canAdvance) {
      throw new Error(`Cannot advance: missing requirements [${missing.join(", ")}]`);
    }

    const currentIndex = PHASE_ORDER.indexOf(this.state.currentPhase);
    this.state.phaseHistory.push({
      phase: this.state.currentPhase,
      enteredAt: this.state.updatedAt,
      exitedAt: Date.now(),
      result: "pass",
    });

    if (currentIndex >= PHASE_ORDER.length - 1) {
      return null; // Workflow complete
    }

    this.state.currentPhase = PHASE_ORDER[currentIndex + 1];
    this.state.retryCount = 0;
    this.state.updatedAt = Date.now();
    return this.state.currentPhase;
  }

  /** Go back to a previous phase (e.g., on failure) */
  rewind(toPhase: WorkflowPhase): void {
    const targetIndex = PHASE_ORDER.indexOf(toPhase);
    const currentIndex = PHASE_ORDER.indexOf(this.state.currentPhase);
    if (targetIndex >= currentIndex) {
      throw new Error(`Can only rewind to earlier phases`);
    }

    this.state.phaseHistory.push({
      phase: this.state.currentPhase,
      enteredAt: this.state.updatedAt,
      exitedAt: Date.now(),
      result: "fail",
    });

    this.state.currentPhase = toPhase;
    this.state.retryCount++;
    this.state.updatedAt = Date.now();

    if (this.state.retryCount >= this.state.maxRetries) {
      throw new Error(`Max retries (${this.state.maxRetries}) exceeded at phase ${toPhase}`);
    }
  }

  /** Skip current phase (for simple tasks) */
  skip(): WorkflowPhase | null {
    const currentIndex = PHASE_ORDER.indexOf(this.state.currentPhase);
    this.state.phaseHistory.push({
      phase: this.state.currentPhase,
      enteredAt: this.state.updatedAt,
      exitedAt: Date.now(),
      result: "skip",
    });

    if (currentIndex >= PHASE_ORDER.length - 1) return null;

    this.state.currentPhase = PHASE_ORDER[currentIndex + 1];
    this.state.updatedAt = Date.now();
    return this.state.currentPhase;
  }

  /** Check if an error triggers auto-repair for this phase */
  shouldAutoRepair(errorType: string): boolean {
    return PHASE_GATES[this.state.currentPhase].autoRepairOn.includes(errorType);
  }

  /** Store workflow artifact */
  setArtifact(key: string, value: unknown): void {
    this.state.artifacts[key] = value;
  }

  getArtifact(key: string): unknown {
    return this.state.artifacts[key];
  }

  /** Serialize state for persistence */
  toJSON(): string {
    return JSON.stringify(this.state);
  }

  static fromJSON(json: string): WorkflowEngine {
    const state = JSON.parse(json) as WorkflowState;
    const engine = new WorkflowEngine(state.id, state.maxRetries);
    engine.state = state;
    return engine;
  }
}

export { PHASE_ORDER, PHASE_GATES };
