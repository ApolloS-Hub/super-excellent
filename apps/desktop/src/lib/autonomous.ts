/**
 * Autonomous Agents — 自治认领引擎
 * 参照 s17_autonomous_agents.py：空闲角色自动认领匹配任务
 *
 * ClaimPolicy: 每个角色的技能标签 + 自动认领规则
 * 当新任务进入 task-store，自动匹配合适的角色
 */

import { getTeamConfig, type Worker } from "./team";

export interface ClaimPolicy {
  roleId: string;
  skills: string[];
  autoClaimEnabled: boolean;
  maxConcurrent: number;
}

export interface ClaimEvent {
  taskId: string;
  roleId: string;
  timestamp: number;
  source: "auto" | "manual";
}

type ClaimCallback = (event: ClaimEvent) => void;

const _policies = new Map<string, ClaimPolicy>();
const _claimHistory: ClaimEvent[] = [];
const _callbacks: ClaimCallback[] = [];

/** Default skill mappings per role. */
const DEFAULT_SKILLS: Record<string, string[]> = {
  product: ["product", "requirement", "user_story", "roadmap", "prd"],
  architect: ["architecture", "design", "system", "infra", "database", "schema"],
  developer: ["code", "implement", "feature", "api", "backend", "fix", "bug"],
  frontend: ["ui", "frontend", "component", "css", "react", "design"],
  code_reviewer: ["review", "code_review", "pr", "quality"],
  tester: ["test", "qa", "quality", "e2e", "unit_test", "coverage"],
  devops: ["deploy", "ci", "cd", "pipeline", "docker", "infra", "ops"],
  security: ["security", "auth", "vulnerability", "audit", "permission"],
  writer: ["doc", "documentation", "readme", "guide", "api_doc"],
  researcher: ["research", "analysis", "investigate", "explore", "benchmark"],
  ux_designer: ["ux", "design", "wireframe", "prototype", "user_flow"],
  data_analyst: ["data", "analytics", "report", "metric", "dashboard"],
  ops_director: ["operations", "strategy", "coordination", "planning"],
  growth_hacker: ["growth", "marketing", "acquisition", "conversion"],
  content_ops: ["content", "blog", "article", "publish", "copywriting"],
  legal_compliance: ["legal", "compliance", "policy", "regulation", "privacy"],
  financial_analyst: ["finance", "budget", "cost", "revenue", "forecast"],
  project_manager: ["project", "milestone", "deadline", "sprint", "tracking"],
  customer_support: ["support", "customer", "ticket", "issue", "feedback"],
  risk_analyst: ["risk", "assessment", "mitigation", "contingency"],
};

/** Initialize default policies from team config. */
export function initPolicies(): void {
  const team = getTeamConfig();
  for (const worker of team.workers) {
    if (!_policies.has(worker.id)) {
      _policies.set(worker.id, {
        roleId: worker.id,
        skills: DEFAULT_SKILLS[worker.id] ?? [],
        autoClaimEnabled: true,
        maxConcurrent: 1,
      });
    }
  }
}

/** Set or update a claim policy. */
export function setPolicy(policy: ClaimPolicy): void {
  _policies.set(policy.roleId, policy);
}

/** Get the policy for a role. */
export function getPolicy(roleId: string): ClaimPolicy | null {
  return _policies.get(roleId) ?? null;
}

/** Get all policies. */
export function getAllPolicies(): ClaimPolicy[] {
  return Array.from(_policies.values());
}

/**
 * Match a task title/description against roles and return the best-matched
 * idle worker. Returns null if no match found.
 */
export function matchTask(
  taskTitle: string,
  taskDescription = "",
): { worker: Worker; policy: ClaimPolicy } | null {
  const team = getTeamConfig();
  const text = `${taskTitle} ${taskDescription}`.toLowerCase();

  let bestMatch: { worker: Worker; policy: ClaimPolicy; score: number } | null = null;

  for (const worker of team.workers) {
    if (worker.status !== "idle") continue;
    const policy = _policies.get(worker.id);
    if (!policy || !policy.autoClaimEnabled) continue;

    let score = 0;
    for (const skill of policy.skills) {
      if (text.includes(skill)) score++;
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { worker, policy, score };
    }
  }

  return bestMatch ? { worker: bestMatch.worker, policy: bestMatch.policy } : null;
}

/**
 * Auto-claim: assign a task to the best-matching worker.
 * Returns the claim event or null if no match.
 */
export function autoClaim(
  taskId: string,
  taskTitle: string,
  taskDescription = "",
): ClaimEvent | null {
  const match = matchTask(taskTitle, taskDescription);
  if (!match) return null;

  const event: ClaimEvent = {
    taskId,
    roleId: match.worker.id,
    timestamp: Date.now(),
    source: "auto",
  };
  _claimHistory.push(event);

  for (const cb of _callbacks) {
    try { cb(event); } catch { /* ignore */ }
  }
  return event;
}

/** Manual claim by a specific role. */
export function manualClaim(taskId: string, roleId: string): ClaimEvent {
  const event: ClaimEvent = {
    taskId,
    roleId,
    timestamp: Date.now(),
    source: "manual",
  };
  _claimHistory.push(event);
  for (const cb of _callbacks) {
    try { cb(event); } catch { /* ignore */ }
  }
  return event;
}

/** Get claim history. */
export function getClaimHistory(): ClaimEvent[] {
  return [..._claimHistory];
}

/** Subscribe to claim events. */
export function onClaim(callback: ClaimCallback): () => void {
  _callbacks.push(callback);
  return () => {
    const idx = _callbacks.indexOf(callback);
    if (idx >= 0) _callbacks.splice(idx, 1);
  };
}

/** Reset all state (for testing). */
export function resetAutonomous(): void {
  _policies.clear();
  _claimHistory.length = 0;
  _callbacks.length = 0;
}
