/**
 * Worktree Isolation — 并行隔离引擎
 * 参照 s18_worktree_task_isolation.py：逻辑隔离（不依赖 git worktree）
 *
 * WorktreeRecord: 每个 Worker 的逻辑工作目录
 * 暂不做 git worktree（需要 Rust 后端），先做逻辑隔离
 */

export type WorktreeStatus = "active" | "completed" | "removed";

export interface WorktreeRecord {
  id: string;
  path: string;
  taskId: string;
  branch: string;
  workerId: string;
  status: WorktreeStatus;
  createdAt: number;
  closedAt: number | null;
}

let _idCounter = 0;
function _genId(): string {
  _idCounter += 1;
  return `wt_${Date.now().toString(36)}_${_idCounter}`;
}

const _worktrees = new Map<string, WorktreeRecord>();

/** Create a new logical worktree for a worker + task. */
export function createWorktree(
  taskId: string,
  workerId: string,
  basePath = "/workspace",
): WorktreeRecord {
  const id = _genId();
  const branch = `wt/${workerId}-${taskId}`;
  const record: WorktreeRecord = {
    id,
    path: `${basePath}/${id}`,
    taskId,
    branch,
    workerId,
    status: "active",
    createdAt: Date.now(),
    closedAt: null,
  };
  _worktrees.set(id, record);
  return record;
}

/** Get a worktree by ID. */
export function getWorktree(id: string): WorktreeRecord | null {
  return _worktrees.get(id) ?? null;
}

/** Get worktree by task ID. */
export function getWorktreeByTask(taskId: string): WorktreeRecord | null {
  for (const wt of _worktrees.values()) {
    if (wt.taskId === taskId && wt.status === "active") return wt;
  }
  return null;
}

/** Get worktree by worker ID. */
export function getWorktreeByWorker(workerId: string): WorktreeRecord | null {
  for (const wt of _worktrees.values()) {
    if (wt.workerId === workerId && wt.status === "active") return wt;
  }
  return null;
}

/** Get all worktrees. */
export function getAllWorktrees(): WorktreeRecord[] {
  return Array.from(_worktrees.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Get active worktrees only. */
export function getActiveWorktrees(): WorktreeRecord[] {
  return getAllWorktrees().filter(wt => wt.status === "active");
}

/** Mark a worktree as completed. */
export function completeWorktree(id: string): boolean {
  const wt = _worktrees.get(id);
  if (!wt || wt.status !== "active") return false;
  wt.status = "completed";
  wt.closedAt = Date.now();
  return true;
}

/** Remove (mark as removed) a worktree. */
export function removeWorktree(id: string): boolean {
  const wt = _worktrees.get(id);
  if (!wt) return false;
  wt.status = "removed";
  wt.closedAt = Date.now();
  return true;
}

/**
 * Resolve the working directory for a worker.
 * If the worker has an active worktree, returns its path.
 * Otherwise returns the default workspace path.
 */
export function resolveWorkDir(workerId: string, defaultPath = "/workspace"): string {
  const wt = getWorktreeByWorker(workerId);
  return wt ? wt.path : defaultPath;
}

/** Reset all state (for testing). */
export function resetWorktrees(): void {
  _worktrees.clear();
  _idCounter = 0;
}
