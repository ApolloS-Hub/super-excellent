/**
 * Task Dependency Graph
 * Inspired by Trellis task system + learn-claude-code s07 + ClawTeam task allocation
 * Tasks have dependencies, can run in parallel, and support assignment to workers
 */

export type TaskStatus = "pending" | "ready" | "running" | "done" | "failed" | "blocked" | "skipped";
export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;
  dependencies: string[];
  subtasks: string[];
  parentId?: string;
  phase?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  artifacts: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  error?: string;
}

export interface TaskGraph {
  id: string;
  tasks: Map<string, Task>;
  createdAt: number;
  updatedAt: number;
}

export function createTaskGraph(id: string): TaskGraph {
  return {
    id,
    tasks: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function addTask(
  graph: TaskGraph,
  task: Omit<Task, "status" | "createdAt" | "retryCount" | "artifacts">,
): Task {
  const fullTask: Task = {
    ...task,
    status: "pending",
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: task.maxRetries ?? 3,
    artifacts: {},
  };

  graph.tasks.set(fullTask.id, fullTask);
  graph.updatedAt = Date.now();

  // Link subtasks to parent
  if (fullTask.parentId) {
    const parent = graph.tasks.get(fullTask.parentId);
    if (parent && !parent.subtasks.includes(fullTask.id)) {
      parent.subtasks.push(fullTask.id);
    }
  }

  updateReadiness(graph);
  return fullTask;
}

/** Get tasks whose dependencies are all done → ready to execute */
export function getReadyTasks(graph: TaskGraph): Task[] {
  return Array.from(graph.tasks.values()).filter(t => t.status === "ready");
}

/** Get tasks that can run in parallel (ready + no mutual dependencies) */
export function getParallelTasks(graph: TaskGraph): Task[][] {
  const ready = getReadyTasks(graph);
  if (ready.length <= 1) return [ready];

  // Group by independence
  const groups: Task[][] = [];
  const assigned = new Set<string>();

  for (const task of ready) {
    if (assigned.has(task.id)) continue;

    const group = [task];
    assigned.add(task.id);

    for (const other of ready) {
      if (assigned.has(other.id)) continue;
      // Two tasks can run in parallel if neither depends on the other
      const independent = !task.dependencies.includes(other.id) && !other.dependencies.includes(task.id);
      if (independent) {
        group.push(other);
        assigned.add(other.id);
      }
    }
    groups.push(group);
  }

  return groups;
}

export function startTask(graph: TaskGraph, taskId: string, assignee?: string): void {
  const task = graph.tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== "ready") throw new Error(`Task ${taskId} is ${task.status}, not ready`);

  task.status = "running";
  task.startedAt = Date.now();
  if (assignee) task.assignee = assignee;
  graph.updatedAt = Date.now();
}

export function completeTask(graph: TaskGraph, taskId: string, artifacts?: Record<string, unknown>): void {
  const task = graph.tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  task.status = "done";
  task.completedAt = Date.now();
  if (task.startedAt) {
    task.actualMinutes = Math.round((task.completedAt - task.startedAt) / 60000);
  }
  if (artifacts) {
    Object.assign(task.artifacts, artifacts);
  }
  graph.updatedAt = Date.now();
  updateReadiness(graph);
}

export function failTask(graph: TaskGraph, taskId: string, error: string): boolean {
  const task = graph.tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  task.retryCount++;
  task.error = error;

  if (task.retryCount >= task.maxRetries) {
    task.status = "failed";
    // Block dependent tasks
    for (const [, t] of graph.tasks) {
      if (t.dependencies.includes(taskId) && t.status === "pending") {
        t.status = "blocked";
      }
    }
    graph.updatedAt = Date.now();
    return false; // No more retries
  }

  task.status = "ready"; // Allow retry
  graph.updatedAt = Date.now();
  return true; // Can retry
}

/** Get completion stats */
export function getProgress(graph: TaskGraph): {
  total: number;
  done: number;
  running: number;
  ready: number;
  pending: number;
  failed: number;
  blocked: number;
  percent: number;
} {
  const tasks = Array.from(graph.tasks.values());
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "done" || t.status === "skipped").length;
  const running = tasks.filter(t => t.status === "running").length;
  const ready = tasks.filter(t => t.status === "ready").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  const blocked = tasks.filter(t => t.status === "blocked").length;

  return { total, done, running, ready, pending, failed, blocked, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** Update readiness based on dependency completion */
function updateReadiness(graph: TaskGraph): void {
  for (const [, task] of graph.tasks) {
    if (task.status !== "pending") continue;

    const depsComplete = task.dependencies.every(depId => {
      const dep = graph.tasks.get(depId);
      return dep && (dep.status === "done" || dep.status === "skipped");
    });

    if (depsComplete) {
      task.status = "ready";
    }
  }
}

/** Topological sort for execution order */
export function getExecutionOrder(graph: TaskGraph): Task[] {
  const visited = new Set<string>();
  const order: Task[] = [];

  function visit(taskId: string) {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = graph.tasks.get(taskId);
    if (!task) return;

    for (const depId of task.dependencies) {
      visit(depId);
    }
    order.push(task);
  }

  for (const [id] of graph.tasks) {
    visit(id);
  }

  return order;
}
