/**
 * Background Tasks — 后台异步执行引擎
 * 参照 s13_background_tasks.py：用 setTimeout 模拟异步执行
 *
 * BackgroundTask: 单个后台任务记录
 * TaskRunner: 提交/查询/回调管理
 */

export type BackgroundTaskStatus = "pending" | "running" | "completed" | "error";

export interface BackgroundTask {
  id: string;
  title: string;
  status: BackgroundTaskStatus;
  startedAt: number;
  completedAt: number | null;
  result: string | null;
  error: string | null;
}

type TaskExecutor = () => Promise<string>;
type CompletionCallback = (task: BackgroundTask) => void;

let _idCounter = 0;
const _tasks = new Map<string, BackgroundTask>();
const _callbacks: CompletionCallback[] = [];

function _genId(): string {
  _idCounter += 1;
  return `bg_${Date.now().toString(36)}_${_idCounter}`;
}

/**
 * Submit a background task. Returns the task ID immediately.
 * The executor runs asynchronously via setTimeout(0).
 */
export function submitTask(title: string, executor: TaskExecutor): string {
  const id = _genId();
  const task: BackgroundTask = {
    id,
    title,
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
    result: null,
    error: null,
  };
  _tasks.set(id, task);

  // Use setTimeout to simulate non-blocking async execution
  setTimeout(async () => {
    try {
      const result = await executor();
      task.status = "completed";
      task.result = result;
    } catch (err) {
      task.status = "error";
      task.error = err instanceof Error ? err.message : String(err);
    } finally {
      task.completedAt = Date.now();
      for (const cb of _callbacks) {
        try { cb(task); } catch { /* ignore callback errors */ }
      }
    }
  }, 0);

  return id;
}

/** Get the current status of a background task. */
export function getTaskStatus(id: string): BackgroundTask | null {
  return _tasks.get(id) ?? null;
}

/** Get all background tasks. */
export function getAllBackgroundTasks(): BackgroundTask[] {
  return Array.from(_tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
}

/** Register a callback that fires whenever a task completes. */
export function onTaskComplete(callback: CompletionCallback): () => void {
  _callbacks.push(callback);
  return () => {
    const idx = _callbacks.indexOf(callback);
    if (idx >= 0) _callbacks.splice(idx, 1);
  };
}

/** Get counts by status. */
export function getBackgroundTaskStats(): Record<BackgroundTaskStatus, number> {
  const stats: Record<BackgroundTaskStatus, number> = {
    pending: 0, running: 0, completed: 0, error: 0,
  };
  for (const t of _tasks.values()) {
    stats[t.status]++;
  }
  return stats;
}

/** Clear all completed/errored tasks. */
export function clearFinishedTasks(): number {
  let cleared = 0;
  for (const [id, t] of _tasks) {
    if (t.status === "completed" || t.status === "error") {
      _tasks.delete(id);
      cleared++;
    }
  }
  return cleared;
}

/** Reset all state (for testing). */
export function resetBackgroundTasks(): void {
  _tasks.clear();
  _callbacks.length = 0;
  _idCounter = 0;
}
