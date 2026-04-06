/**
 * Task Heartbeat — 检测 Worker 是否还活着，自动推进 backlog 任务
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/task-heartbeat.ts
 * Rewritten as in-memory implementation (no filesystem dependencies)
 */

import { getAllTasks, updateTaskStatus } from "./task-store";
import type { ProjectTask } from "./task-store";

const UNASSIGNED_VALUES = new Set(["", "unassigned", "none", "n/a", "unknown", "na"]);

export interface HeartbeatGate {
  enabled: boolean;
  dryRun: boolean;
  maxTasksPerRun: number;
}

export interface HeartbeatSelection {
  projectId: string;
  taskId: string;
  title: string;
  owner: string;
  dueAt?: string;
  fromStatus: "todo";
  toStatus: "in_progress";
}

export interface HeartbeatResult {
  ok: boolean;
  mode: "blocked" | "dry_run" | "live";
  message: string;
  evaluatedAt: string;
  gate: HeartbeatGate;
  checked: number;
  eligible: number;
  selected: number;
  executed: number;
  selections: HeartbeatSelection[];
}

const heartbeatLog: HeartbeatResult[] = [];

let gate: HeartbeatGate = {
  enabled: true,
  dryRun: true,
  maxTasksPerRun: 3,
};

export function configureHeartbeat(config: Partial<HeartbeatGate>): void {
  gate = { ...gate, ...config };
}

export function getHeartbeatGate(): HeartbeatGate {
  return { ...gate };
}

export function selectHeartbeatTasks(
  tasks: ProjectTask[],
  maxPerRun: number,
): HeartbeatSelection[] {
  const safeMax = Number.isFinite(maxPerRun) && maxPerRun > 0 ? Math.floor(maxPerRun) : 0;
  if (safeMax === 0) return [];

  return tasks
    .filter(t => t.status === "todo" && isAssignedOwner(t.owner))
    .sort(compareCandidates)
    .slice(0, safeMax)
    .map(t => ({
      projectId: t.projectId,
      taskId: t.taskId,
      title: t.title,
      owner: t.owner,
      dueAt: t.dueAt,
      fromStatus: "todo" as const,
      toStatus: "in_progress" as const,
    }));
}

export function runHeartbeat(): HeartbeatResult {
  const evaluatedAt = new Date().toISOString();
  const allTasks = getAllTasks();
  const selections = selectHeartbeatTasks(allTasks, gate.maxTasksPerRun);

  const base = {
    evaluatedAt,
    gate: { ...gate },
    checked: allTasks.length,
    eligible: allTasks.filter(t => t.status === "todo" && isAssignedOwner(t.owner)).length,
    selected: selections.length,
    selections,
  };

  if (!gate.enabled) {
    const result: HeartbeatResult = {
      ok: false, mode: "blocked",
      message: "Task heartbeat is disabled.", executed: 0, ...base,
    };
    heartbeatLog.push(result);
    return result;
  }

  if (gate.dryRun) {
    const result: HeartbeatResult = {
      ok: true, mode: "dry_run",
      message: selections.length === 0
        ? "Heartbeat dry-run found no assigned backlog tasks."
        : `Heartbeat dry-run selected ${selections.length} task(s).`,
      executed: 0, ...base,
    };
    heartbeatLog.push(result);
    return result;
  }

  if (selections.length === 0) {
    const result: HeartbeatResult = {
      ok: true, mode: "live",
      message: "Heartbeat live run found no assigned backlog tasks.",
      executed: 0, ...base,
    };
    heartbeatLog.push(result);
    return result;
  }

  let executed = 0;
  for (const sel of selections) {
    try {
      updateTaskStatus(sel.taskId, "in_progress", sel.projectId);
      executed++;
    } catch { /* skip failed transitions */ }
  }

  const result: HeartbeatResult = {
    ok: true, mode: "live",
    message: `Heartbeat started ${executed} assigned backlog task(s).`,
    executed, ...base,
  };
  heartbeatLog.push(result);
  return result;
}

export function getHeartbeatLog(limit = 20): HeartbeatResult[] {
  const safeLimit = Math.min(Math.max(1, limit), 200);
  return heartbeatLog.slice(-safeLimit).reverse();
}

export function resetHeartbeatLog(): void {
  heartbeatLog.length = 0;
}

function isAssignedOwner(owner: string | undefined): boolean {
  if (!owner) return false;
  return !UNASSIGNED_VALUES.has(owner.trim().toLowerCase());
}

function compareCandidates(a: ProjectTask, b: ProjectTask): number {
  const dueDiff = compareOptionalDate(a.dueAt, b.dueAt);
  if (dueDiff !== 0) return dueDiff;
  const updDiff = compareOptionalDate(a.updatedAt, b.updatedAt);
  if (updDiff !== 0) return updDiff;
  return a.taskId.localeCompare(b.taskId);
}

function compareOptionalDate(left?: string, right?: string): number {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}
