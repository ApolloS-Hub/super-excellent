/**
 * Outcome Aggregator — Aggregate Multi-Worker Outputs
 * Ported from: aden-hive-hive/core/framework/runtime/outcome_aggregator.py
 *
 * Tracks decisions and outcomes across multiple execution streams,
 * evaluates progress toward goals, detects constraint violations,
 * and produces unified progress metrics.
 */

import type { EventBus } from "./event-system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuccessCriterion {
  id: string;
  description: string;
  weight: number;
  target?: string;
  type?: "success_rate" | "coverage" | "custom";
}

export interface Constraint {
  id: string;
  description: string;
  constraintType: "hard" | "soft";
}

export interface Goal {
  id: string;
  description: string;
  successCriteria: SuccessCriterion[];
  constraints: Constraint[];
}

export interface Decision {
  id: string;
  intent: string;
  reasoning: string;
  activeConstraints: string[];
}

export interface Outcome {
  success: boolean;
  details?: string;
}

export interface CriterionStatus {
  criterionId: string;
  description: string;
  met: boolean;
  evidence: string[];
  progress: number;
  lastUpdated: string;
}

export interface ConstraintCheck {
  constraintId: string;
  description: string;
  violated: boolean;
  violationDetails?: string;
  streamId?: string;
  executionId?: string;
  timestamp: string;
}

export interface DecisionRecord {
  streamId: string;
  executionId: string;
  decision: Decision;
  outcome?: Outcome;
  timestamp: string;
}

export type ProgressRecommendation = "continue" | "adjust" | "complete";

export interface GoalProgress {
  overallProgress: number;
  criteriaStatus: Record<string, {
    description: string;
    met: boolean;
    progress: number;
    evidence: string[];
  }>;
  constraintViolations: Array<{
    constraintId: string;
    description: string;
    details?: string;
    streamId?: string;
    timestamp: string;
  }>;
  metrics: {
    totalDecisions: number;
    successfulOutcomes: number;
    failedOutcomes: number;
    successRate: number;
    streamsActive: number;
    executionsTotal: number;
  };
  recommendation: ProgressRecommendation;
}

// ---------------------------------------------------------------------------
// OutcomeAggregator
// ---------------------------------------------------------------------------

export class OutcomeAggregator {
  private goal: Goal;
  private eventBus: EventBus | null;

  private decisions: DecisionRecord[] = [];
  private decisionsById = new Map<string, DecisionRecord>();
  private criterionStatus = new Map<string, CriterionStatus>();
  private constraintViolations: ConstraintCheck[] = [];

  private totalDecisions = 0;
  private successfulOutcomes = 0;
  private failedOutcomes = 0;

  constructor(goal: Goal, eventBus?: EventBus) {
    this.goal = goal;
    this.eventBus = eventBus ?? null;
    this.initializeCriteria();
  }

  // -----------------------------------------------------------------------
  // Decision recording
  // -----------------------------------------------------------------------

  recordDecision(streamId: string, executionId: string, decision: Decision): void {
    const record: DecisionRecord = {
      streamId,
      executionId,
      decision,
      timestamp: new Date().toISOString(),
    };
    const key = `${streamId}:${executionId}:${decision.id}`;
    this.decisions.push(record);
    this.decisionsById.set(key, record);
    this.totalDecisions += 1;
  }

  recordOutcome(streamId: string, executionId: string, decisionId: string, outcome: Outcome): void {
    const key = `${streamId}:${executionId}:${decisionId}`;
    const record = this.decisionsById.get(key);
    if (record) {
      record.outcome = outcome;
      if (outcome.success) {
        this.successfulOutcomes += 1;
      } else {
        this.failedOutcomes += 1;
      }
    }
  }

  recordConstraintViolation(input: {
    constraintId: string;
    description: string;
    violationDetails: string;
    streamId?: string;
    executionId?: string;
  }): void {
    this.constraintViolations.push({
      constraintId: input.constraintId,
      description: input.description,
      violated: true,
      violationDetails: input.violationDetails,
      streamId: input.streamId,
      executionId: input.executionId,
      timestamp: new Date().toISOString(),
    });

    if (this.eventBus && input.streamId) {
      this.eventBus.emitConstraintViolation(
        input.streamId,
        input.executionId ?? "",
        input.constraintId,
        input.violationDetails,
      ).catch(() => {/* swallow */});
    }
  }

  // -----------------------------------------------------------------------
  // Goal evaluation
  // -----------------------------------------------------------------------

  async evaluateGoalProgress(): Promise<GoalProgress> {
    const result: GoalProgress = {
      overallProgress: 0,
      criteriaStatus: {},
      constraintViolations: [],
      metrics: {
        totalDecisions: 0,
        successfulOutcomes: 0,
        failedOutcomes: 0,
        successRate: 0,
        streamsActive: 0,
        executionsTotal: 0,
      },
      recommendation: "continue",
    };

    let totalWeight = 0;
    let metWeight = 0;

    for (const criterion of this.goal.successCriteria) {
      const status = this.evaluateCriterion(criterion);
      this.criterionStatus.set(criterion.id, status);
      result.criteriaStatus[criterion.id] = {
        description: status.description,
        met: status.met,
        progress: status.progress,
        evidence: status.evidence,
      };
      totalWeight += criterion.weight;
      metWeight += status.met ? criterion.weight : criterion.weight * status.progress;
    }

    if (totalWeight > 0) result.overallProgress = metWeight / totalWeight;

    result.constraintViolations = this.constraintViolations.map(v => ({
      constraintId: v.constraintId,
      description: v.description,
      details: v.violationDetails,
      streamId: v.streamId,
      timestamp: v.timestamp,
    }));

    const streams = new Set(this.decisions.map(d => d.streamId));
    const executions = new Set(this.decisions.map(d => `${d.streamId}:${d.executionId}`));

    result.metrics = {
      totalDecisions: this.totalDecisions,
      successfulOutcomes: this.successfulOutcomes,
      failedOutcomes: this.failedOutcomes,
      successRate: this.successfulOutcomes / Math.max(1, this.successfulOutcomes + this.failedOutcomes),
      streamsActive: streams.size,
      executionsTotal: executions.size,
    };

    result.recommendation = this.getRecommendation(result);

    if (this.eventBus && streams.size > 0) {
      const firstStream = [...streams][0];
      await this.eventBus.emitGoalProgress(firstStream, result.overallProgress, result.criteriaStatus);
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getDecisionsByStream(streamId: string): DecisionRecord[] {
    return this.decisions.filter(d => d.streamId === streamId);
  }

  getDecisionsByExecution(streamId: string, executionId: string): DecisionRecord[] {
    return this.decisions.filter(d => d.streamId === streamId && d.executionId === executionId);
  }

  getRecentDecisions(limit = 10): DecisionRecord[] {
    return this.decisions.slice(-limit);
  }

  getCriterionStatus(criterionId: string): CriterionStatus | undefined {
    return this.criterionStatus.get(criterionId);
  }

  getStats(): Record<string, number> {
    return {
      totalDecisions: this.totalDecisions,
      successfulOutcomes: this.successfulOutcomes,
      failedOutcomes: this.failedOutcomes,
      constraintViolations: this.constraintViolations.length,
      criteriaTracked: this.criterionStatus.size,
      streamsSeen: new Set(this.decisions.map(d => d.streamId)).size,
    };
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this.decisions = [];
    this.decisionsById.clear();
    this.constraintViolations = [];
    this.totalDecisions = 0;
    this.successfulOutcomes = 0;
    this.failedOutcomes = 0;
    this.initializeCriteria();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private initializeCriteria(): void {
    this.criterionStatus.clear();
    for (const c of this.goal.successCriteria) {
      this.criterionStatus.set(c.id, {
        criterionId: c.id,
        description: c.description,
        met: false,
        evidence: [],
        progress: 0,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  private evaluateCriterion(criterion: SuccessCriterion): CriterionStatus {
    const status: CriterionStatus = {
      criterionId: criterion.id,
      description: criterion.description,
      met: false,
      evidence: [],
      progress: 0,
      lastUpdated: new Date().toISOString(),
    };

    if (criterion.type && criterion.type !== "success_rate") return status;

    const relevant = this.decisions.filter(
      d =>
        d.decision.activeConstraints.includes(criterion.id) ||
        this.isRelated(d.decision, criterion),
    );
    if (relevant.length === 0) return status;

    const outcomes = relevant.filter(d => d.outcome != null).map(d => d.outcome!);
    if (outcomes.length > 0) {
      const successCount = outcomes.filter(o => o.success).length;
      status.progress = successCount / outcomes.length;

      for (const d of relevant.slice(0, 5)) {
        if (d.outcome) {
          status.evidence.push(
            `decision=${d.decision.id} intent=${d.decision.intent} result=${d.outcome.success ? "success" : "failed"}`,
          );
        }
      }
    }

    const targetValue = parseTarget(criterion.target);
    status.met = status.progress >= targetValue;

    return status;
  }

  private isRelated(decision: Decision, criterion: SuccessCriterion): boolean {
    const keywords = criterion.description.toLowerCase().split(/\s+/);
    const text = `${decision.intent} ${decision.reasoning}`.toLowerCase();
    return keywords.filter(kw => text.includes(kw)).length >= 2;
  }

  private getRecommendation(result: GoalProgress): ProgressRecommendation {
    const hardViolations = result.constraintViolations.filter(v => {
      const c = this.goal.constraints.find(con => con.id === v.constraintId);
      return c?.constraintType === "hard";
    });
    if (hardViolations.length > 0) return "adjust";
    if (result.overallProgress >= 0.95) return "complete";
    if (result.overallProgress < 0.3 && result.metrics.totalDecisions > 10) return "adjust";
    return "continue";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTarget(target: string | undefined): number {
  if (!target) return 0.8;
  if (target.endsWith("%")) {
    const n = parseFloat(target.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : 0.8;
  }
  return 0.8;
}
